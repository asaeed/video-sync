#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <math.h>

static id CopyAttribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) return nil;
  return CFBridgingRelease(value);
}

static NSString *StringAttribute(AXUIElementRef element, CFStringRef name) {
  id value = CopyAttribute(element, name);
  return [value isKindOfClass:NSString.class] ? value : nil;
}

static NSPoint ElementPosition(AXUIElementRef element) {
  id raw = CopyAttribute(element, kAXPositionAttribute);
  AXValueRef value = (__bridge AXValueRef)raw;
  CGPoint point = CGPointZero;
  if (value && CFGetTypeID(value) == AXValueGetTypeID() &&
      AXValueGetValue(value, kAXValueCGPointType, &point)) {
    return NSMakePoint(point.x, point.y);
  }
  return NSMakePoint(NAN, NAN);
}

static NSSize ElementSize(AXUIElementRef element) {
  id raw = CopyAttribute(element, kAXSizeAttribute);
  AXValueRef value = (__bridge AXValueRef)raw;
  CGSize size = CGSizeZero;
  if (value && CFGetTypeID(value) == AXValueGetTypeID() &&
      AXValueGetValue(value, kAXValueCGSizeType, &size)) {
    return NSMakeSize(size.width, size.height);
  }
  return NSMakeSize(NAN, NAN);
}

static BOOL IsDeckBPMField(AXUIElementRef element) {
  NSString *role = StringAttribute(element, kAXRoleAttribute);
  return [role isEqualToString:(__bridge NSString *)kAXTextFieldRole] ||
    [role isEqualToString:(__bridge NSString *)kAXTextAreaRole];
}

static BOOL IsDeckCandidate(AXUIElementRef element) {
  NSString *role = StringAttribute(element, kAXRoleAttribute);
  return [role isEqualToString:(__bridge NSString *)kAXStaticTextRole] ||
    IsDeckBPMField(element) ||
    [role isEqualToString:(__bridge NSString *)kAXButtonRole] ||
    [role isEqualToString:(__bridge NSString *)kAXImageRole];
}

static void CollectDeckCandidates(AXUIElementRef element, NSInteger depth, NSMutableArray *elements) {
  if (depth >= 20) return;
  if (IsDeckCandidate(element)) {
    [elements addObject:CFBridgingRelease(CFRetain(element))];
  }
  NSArray *children = CopyAttribute(element, kAXChildrenAttribute);
  for (id child in children) {
    CollectDeckCandidates((__bridge AXUIElementRef)child, depth + 1, elements);
  }
}

static NSNumber *ParseBPM(NSString *value) {
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *trimmed = [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[0-9]{2,3}\\.[0-9]{2}$" options:0 error:nil];
  if ([pattern numberOfMatchesInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)] != 1) return nil;
  double bpm = trimmed.doubleValue;
  return bpm >= 40.0 && bpm <= 300.0 ? @(bpm) : nil;
}

static NSNumber *ParseClockSeconds(NSString *value) {
  if (![value isKindOfClass:NSString.class] || [value hasPrefix:@"-"]) return nil;
  NSArray<NSString *> *parts = [value componentsSeparatedByString:@":"];
  if (parts.count != 2 || parts[0].length < 1 || parts[1].length != 2) return nil;
  NSCharacterSet *nonDigits = NSCharacterSet.decimalDigitCharacterSet.invertedSet;
  if ([parts[0] rangeOfCharacterFromSet:nonDigits].location != NSNotFound ||
      [parts[1] rangeOfCharacterFromSet:nonDigits].location != NSNotFound) return nil;
  NSInteger minutes = parts[0].integerValue;
  NSInteger seconds = parts[1].integerValue;
  return seconds < 60 ? @(minutes * 60 + seconds) : nil;
}

static NSNumber *ParseTenths(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length != 2 || ![value hasPrefix:@"."]) return nil;
  unichar digit = [value characterAtIndex:1];
  return digit >= '0' && digit <= '9' ? @((digit - '0') / 10.0) : nil;
}

static NSString *TrimmedString(NSString *value) {
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *trimmed = [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  return trimmed.length > 0 ? trimmed : nil;
}

static NSString *JoinedMetadata(NSDictionary *record) {
  NSMutableOrderedSet<NSString *> *parts = [NSMutableOrderedSet orderedSet];
  for (NSString *key in @[ @"value", @"title", @"description", @"help", @"identifier" ]) {
    NSString *part = TrimmedString(record[key]);
    if (part) [parts addObject:part];
  }
  return [parts.array componentsJoinedByString:@" · "];
}

static BOOL ContainsLetters(NSString *value) {
  return [value rangeOfCharacterFromSet:NSCharacterSet.letterCharacterSet].location != NSNotFound;
}

static BOOL IsIgnoredTrackText(NSString *value) {
  NSString *lower = value.lowercaseString;
  NSSet<NSString *> *ignored = [NSSet setWithArray:@[
    @"rekordbox", @"pad", @"midi", @"master", @"sync", @"key", @"bpm", @"hot cue",
    @"memory", @"beat loop", @"beat jump", @"sampler", @"release fx", @"active",
    @"not loaded.",
  ]];
  if ([ignored containsObject:lower] || value.length < 2 || value.length > 180 || !ContainsLetters(value)) return YES;
  if (ParseBPM(value) || ParseClockSeconds(value) || ParseTenths(value)) return YES;
  NSRegularExpression *numeric = [NSRegularExpression regularExpressionWithPattern:@"^[0-9 .:+-]+$" options:0 error:nil];
  return [numeric numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] > 0;
}

static NSDictionary *VisibleTrackIdentity(NSArray<NSDictionary *> *records, NSNumber *deck, double windowTop, double deckBandBottom) {
  NSDictionary *bestTitle = nil;
  NSDictionary *bestArtist = nil;
  NSInteger bestTitleScore = NSIntegerMin;
  NSInteger bestArtistScore = NSIntegerMin;
  for (NSDictionary *record in records) {
    if (![record[@"deck"] isEqual:deck]) continue;
    NSString *value = TrimmedString(record[@"value"]);
    if (!value || IsIgnoredTrackText(value)) continue;
    double y = [record[@"y"] doubleValue];
    if (y < windowTop || y >= deckBandBottom) continue;
    NSString *metadata = JoinedMetadata(record).lowercaseString;
    NSString *identifierValue = [record[@"identifier"] lowercaseString];
    NSString *identifier = identifierValue ? identifierValue : @"";
    double width = [record[@"width"] doubleValue];
    NSInteger lengthScore = value.length / 6;
    if (lengthScore > 12) lengthScore = 12;
    BOOL isDeckTitleBand = y >= windowTop + 125.0 && y <= windowTop + 180.0 && width >= 180.0;
    NSInteger geometryScore = (y <= windowTop + 250.0 ? 12 : 0) + (width >= 90.0 ? 12 : 0) + lengthScore + (isDeckTitleBand ? 35 : 0);
    NSInteger titleScore = geometryScore;
    NSInteger artistScore = geometryScore - 8;
    if ([metadata containsString:@"track title"] || [metadata containsString:@"song title"]) titleScore += 100;
    else if ([identifier containsString:@"title"]) titleScore += 70;
    else if ([metadata containsString:@"title"] && [metadata containsString:@"deck"]) titleScore += 55;
    if ([metadata containsString:@"artist"] || [identifier containsString:@"artist"]) artistScore += 90;
    if (titleScore > bestTitleScore) {
      bestTitleScore = titleScore;
      bestTitle = record;
    }
    if (artistScore > bestArtistScore) {
      bestArtistScore = artistScore;
      bestArtist = record;
    }
  }

  // Geometry is a fallback for Rekordbox builds that expose the visible deck
  // header as anonymous static text. Requiring a wide element in the upper
  // deck band avoids treating pad labels and cue timestamps as track names.
  NSString *title = bestTitleScore >= 32 ? TrimmedString(bestTitle[@"value"]) : nil;
  NSString *artist = bestArtistScore >= 65 ? TrimmedString(bestArtist[@"value"]) : nil;
  if ([artist isEqualToString:title]) artist = nil;
  NSString *basis = bestTitleScore >= 70 ? @"accessibility-label" : (title ? @"deck-header-heuristic" : @"unavailable");
  return @{
    @"trackTitle": title ? title : NSNull.null,
    @"trackArtist": artist ? artist : NSNull.null,
    @"trackIdentityBasis": basis,
  };
}

static NSNumber *ClockSecondsForRecord(NSDictionary *record, NSArray<NSDictionary *> *records) {
  NSNumber *wholeSeconds = ParseClockSeconds(record[@"value"]);
  if (!wholeSeconds) return nil;
  for (NSDictionary *fractionRecord in records) {
    if (![fractionRecord[@"deck"] isEqual:record[@"deck"]]) continue;
    NSNumber *tenths = ParseTenths(fractionRecord[@"value"]);
    double xDistance = [fractionRecord[@"x"] doubleValue] - [record[@"x"] doubleValue];
    double yDistance = fabs([fractionRecord[@"y"] doubleValue] - [record[@"y"] doubleValue]);
    if (tenths && xDistance > 0 && xDistance < 80 && yDistance <= 4) {
      return @([wholeSeconds doubleValue] + [tenths doubleValue]);
    }
  }
  return wholeSeconds;
}

static NSString *CueKindFromMetadata(NSString *metadata) {
  NSString *lower = metadata.lowercaseString;
  if ([lower containsString:@"loop"]) return @"loop";
  if ([lower containsString:@"cue"]) return @"cue";
  return @"unknown";
}

static NSNumber *CueLengthBeatsFromMetadata(NSString *metadata) {
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"([0-9]+(?:\\.[0-9]+)?)\\s*(?:beat|beats)" options:NSRegularExpressionCaseInsensitive error:nil];
  NSTextCheckingResult *match = [pattern firstMatchInString:metadata options:0 range:NSMakeRange(0, metadata.length)];
  if (!match || [match rangeAtIndex:1].location == NSNotFound) return nil;
  double beats = [[metadata substringWithRange:[match rangeAtIndex:1]] doubleValue];
  return beats > 0 && beats <= 256 ? @(beats) : nil;
}

static NSRunningApplication *FindRekordbox(void) {
  for (NSRunningApplication *candidate in NSWorkspace.sharedWorkspace.runningApplications) {
    if ([candidate.localizedName.lowercaseString isEqualToString:@"rekordbox"]) return candidate;
  }
  return nil;
}

static NSDictionary *ScanDeckElements(NSRunningApplication *rekordbox, BOOL includeDebugElements) {
  AXUIElementRef application = AXUIElementCreateApplication(rekordbox.processIdentifier);
  NSArray *windows = CopyAttribute(application, kAXWindowsAttribute);
  AXUIElementRef window = windows.count > 0 ? (__bridge AXUIElementRef)windows[0] : application;
  NSPoint windowPosition = ElementPosition(window);
  NSSize windowSize = ElementSize(window);
  double midpoint = isfinite(windowPosition.x) && isfinite(windowSize.width)
    ? windowPosition.x + (windowSize.width / 2.0)
    : NSScreen.mainScreen.frame.size.width / 2.0;
  double deckBandBottom = isfinite(windowPosition.y) ? windowPosition.y + 380.0 : 430.0;

  NSMutableArray *elements = [NSMutableArray array];
  CollectDeckCandidates(application, 0, elements);
  CFRelease(application);

  NSMutableArray *records = [NSMutableArray array];
  for (id item in elements) {
    AXUIElementRef element = (__bridge AXUIElementRef)item;
    NSString *value = TrimmedString(StringAttribute(element, kAXValueAttribute));
    NSString *title = TrimmedString(StringAttribute(element, kAXTitleAttribute));
    NSString *description = TrimmedString(StringAttribute(element, kAXDescriptionAttribute));
    NSString *help = TrimmedString(StringAttribute(element, kAXHelpAttribute));
    NSString *identifier = TrimmedString(StringAttribute(element, kAXIdentifierAttribute));
    NSPoint point = ElementPosition(element);
    NSSize size = ElementSize(element);
    if ((!value && !title && !description && !help && !identifier) || !isfinite(point.x) || !isfinite(point.y)) continue;
    [records addObject:@{
      @"value": value ? value : @"",
      @"title": title ? title : @"",
      @"description": description ? description : @"",
      @"help": help ? help : @"",
      @"identifier": identifier ? identifier : @"",
      @"x": @(point.x),
      @"y": @(point.y),
      @"width": isfinite(size.width) ? @(size.width) : @0,
      @"height": isfinite(size.height) ? @(size.height) : @0,
      @"deck": point.x < midpoint ? @1 : @2,
      @"field": @(IsDeckBPMField(element)),
    }];
  }

  NSMutableDictionary *bestBPM = [NSMutableDictionary dictionary];
  for (NSDictionary *record in records) {
    NSNumber *bpm = ParseBPM(record[@"value"]);
    BOOL isCurrentBPM = [record[@"field"] boolValue];
    double pointY = [record[@"y"] doubleValue];
    if (!bpm || (!isCurrentBPM && pointY > deckBandBottom)) continue;
    NSNumber *deck = record[@"deck"];
    NSDictionary *current = bestBPM[deck];
    NSInteger priority = isCurrentBPM ? 2 : 1;
    if (!current || priority > [current[@"priority"] integerValue] ||
        (priority == [current[@"priority"] integerValue] && pointY < [current[@"y"] doubleValue])) {
      bestBPM[deck] = @{ @"y": @(pointY), @"bpm": bpm, @"priority": @(priority) };
    }
  }

  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  double cueRegionTop = isfinite(windowPosition.y) ? windowPosition.y + 270.0 : 320.0;
  double playheadRegionTop = isfinite(windowPosition.y) ? windowPosition.y + 130.0 : 180.0;
  double playheadRegionBottom = isfinite(windowPosition.y) ? windowPosition.y + 230.0 : 280.0;
  for (NSNumber *deck in @[ @1, @2 ]) {
    NSNumber *positionSeconds = nil;
    for (NSDictionary *clockRecord in records) {
      double clockY = [clockRecord[@"y"] doubleValue];
      if (![clockRecord[@"deck"] isEqual:deck] || clockY < playheadRegionTop || clockY > playheadRegionBottom) continue;
      positionSeconds = ClockSecondsForRecord(clockRecord, records);
      if (positionSeconds) break;
    }

    BOOL hotCueMetadataVisible = NO;
    for (NSDictionary *record in records) {
      if (![record[@"deck"] isEqual:deck] || [record[@"y"] doubleValue] < cueRegionTop) continue;
      NSString *letter = record[@"value"];
      if (letter.length != 1) continue;
      unichar cueCharacter = [letter characterAtIndex:0];
      if (cueCharacter >= 'A' && cueCharacter <= 'H') {
        hotCueMetadataVisible = YES;
        break;
      }
    }

    NSMutableArray *hotCues = [NSMutableArray array];
    for (NSDictionary *cueRecord in records) {
      if (![cueRecord[@"deck"] isEqual:deck] || [cueRecord[@"y"] doubleValue] < cueRegionTop) continue;
      NSString *letter = cueRecord[@"value"];
      if (letter.length != 1) continue;
      unichar cueCharacter = [letter characterAtIndex:0];
      if (cueCharacter < 'A' || cueCharacter > 'H') continue;
      for (NSDictionary *timeRecord in records) {
        if (![timeRecord[@"deck"] isEqual:deck]) continue;
        NSNumber *cueSeconds = ClockSecondsForRecord(timeRecord, records);
        double xDistance = fabs([timeRecord[@"x"] doubleValue] - [cueRecord[@"x"] doubleValue]);
        double yDistance = [timeRecord[@"y"] doubleValue] - [cueRecord[@"y"] doubleValue];
        if (cueSeconds && xDistance <= 10 && yDistance >= 5 && yDistance <= 35) {
          NSMutableString *metadata = [NSMutableString stringWithString:JoinedMetadata(cueRecord)];
          for (NSDictionary *nearby in records) {
            if (![nearby[@"deck"] isEqual:deck]) continue;
            double nearbyX = fabs([nearby[@"x"] doubleValue] - [cueRecord[@"x"] doubleValue]);
            double nearbyY = fabs([nearby[@"y"] doubleValue] - [cueRecord[@"y"] doubleValue]);
            if (nearbyX <= 22 && nearbyY <= 18) [metadata appendFormat:@" · %@", JoinedMetadata(nearby)];
          }
          NSString *kind = CueKindFromMetadata(metadata);
          NSNumber *lengthBeats = CueLengthBeatsFromMetadata(metadata);
          NSMutableDictionary *cue = [@{
            @"cueIndex": @(cueCharacter - 'A'),
            @"timeSeconds": cueSeconds,
            @"kind": kind,
            @"metadataBasis": [kind isEqualToString:@"unknown"] ? @"timestamp-only" : @"accessibility-label",
          } mutableCopy];
          if (lengthBeats) cue[@"lengthBeats"] = lengthBeats;
          if ([kind isEqualToString:@"loop"]) {
            for (NSDictionary *endRecord in records) {
              if (![endRecord[@"deck"] isEqual:deck] || endRecord == timeRecord) continue;
              NSNumber *endSeconds = ClockSecondsForRecord(endRecord, records);
              double endX = fabs([endRecord[@"x"] doubleValue] - [cueRecord[@"x"] doubleValue]);
              double endY = [endRecord[@"y"] doubleValue] - [timeRecord[@"y"] doubleValue];
              if (endSeconds && [endSeconds doubleValue] > [cueSeconds doubleValue] && endX <= 12 && endY >= 3 && endY <= 35) {
                cue[@"endTimeSeconds"] = endSeconds;
                break;
              }
            }
          }
          [hotCues addObject:cue];
          break;
        }
      }
    }
    [hotCues sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
      return [left[@"cueIndex"] compare:right[@"cueIndex"]];
    }];

    NSDictionary *trackIdentity = VisibleTrackIdentity(records, deck, isfinite(windowPosition.y) ? windowPosition.y : 0, deckBandBottom);
    result[deck] = @{
      @"bpm": bestBPM[deck][@"bpm"] ? bestBPM[deck][@"bpm"] : NSNull.null,
      @"positionSeconds": positionSeconds ? positionSeconds : NSNull.null,
      @"hotCues": hotCues,
      @"hotCueMetadataVisible": @(hotCueMetadataVisible),
      @"trackTitle": trackIdentity[@"trackTitle"],
      @"trackArtist": trackIdentity[@"trackArtist"],
      @"trackIdentityBasis": trackIdentity[@"trackIdentityBasis"],
    };
  }
  if (includeDebugElements) result[@"debugElements"] = records;
  return result;
}

static long long UnixMilliseconds(void) {
  return (long long)llround(NSDate.date.timeIntervalSince1970 * 1000.0);
}

static unsigned long long SourceMicroseconds(void) {
  return (unsigned long long)llround(NSProcessInfo.processInfo.systemUptime * 1000000.0);
}

static void Emit(NSString *type, NSDictionary *payload, unsigned long long sequence) {
  NSDictionary *message = @{
    @"v": @1,
    @"seq": @(sequence),
    @"sourceTimeUs": @(SourceMicroseconds()),
    @"emittedAtUnixMs": @(UnixMilliseconds()),
    @"source": @"rekordbox-accessibility",
    @"type": type,
    @"payload": payload,
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  NSFileHandle *output = [NSFileHandle fileHandleWithStandardOutput];
  [output writeData:data];
  [output writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
}

int main(void) {
  @autoreleasepool {
    unsigned long long sequence = 0;
    BOOL dumpElements = [NSProcessInfo.processInfo.arguments containsObject:@"--dump-elements"];
    NSDictionary *trustOptions = @{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES };
    if (!AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)trustOptions)) {
      Emit(@"rekordbox.adapter-status", @{ @"state": @"permission-required", @"detail": @"Enable Accessibility access for the video-sync host." }, ++sequence);
      return 2;
    }

    NSString *lastSignature = @"";
    NSTimeInterval lastEmit = 0;
    BOOL announcedReady = NO;

    while (YES) {
      @autoreleasepool {
        NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
        NSRunningApplication *rekordbox = FindRekordbox();
        if (!rekordbox) {
          if (![lastSignature isEqualToString:@"not-running"] || now - lastEmit >= 1.0) {
            Emit(@"rekordbox.adapter-status", @{ @"state": @"waiting", @"detail": @"rekordbox is not running." }, ++sequence);
            lastSignature = @"not-running";
            lastEmit = now;
          }
          [NSThread sleepForTimeInterval:0.25];
          continue;
        }

        if (!announcedReady) {
          Emit(@"rekordbox.adapter-status", @{ @"state": @"running", @"detail": @"Reading visible Rekordbox BPM, playhead, and hot-cue values." }, ++sequence);
          announcedReady = YES;
        }

        NSDictionary *observed = ScanDeckElements(rekordbox, dumpElements);
        if (dumpElements) {
          Emit(@"rekordbox.adapter-debug", @{ @"elements": observed[@"debugElements"] ? observed[@"debugElements"] : @[] }, ++sequence);
          return 0;
        }

        NSMutableArray *decks = [NSMutableArray array];
        for (NSNumber *deck in @[ @1, @2 ]) {
          id rawBPM = observed[deck][@"bpm"];
          NSNumber *bpm = [rawBPM isKindOfClass:NSNumber.class] ? rawBPM : nil;
          id trackTitleValue = observed[deck][@"trackTitle"];
          id trackArtistValue = observed[deck][@"trackArtist"];
          id trackTitle = trackTitleValue ? trackTitleValue : NSNull.null;
          id trackArtist = trackArtistValue ? trackArtistValue : NSNull.null;
          BOOL loaded = bpm != nil || [trackTitle isKindOfClass:NSString.class];
          [decks addObject:@{
            @"deck": deck,
            @"loaded": @(loaded),
            @"bpm": bpm ? bpm : NSNull.null,
            @"positionSeconds": observed[deck][@"positionSeconds"] ? observed[deck][@"positionSeconds"] : NSNull.null,
            @"hotCues": observed[deck][@"hotCues"] ? observed[deck][@"hotCues"] : @[],
            @"hotCueMetadataVisible": observed[deck][@"hotCueMetadataVisible"] ? observed[deck][@"hotCueMetadataVisible"] : @NO,
            @"trackTitle": trackTitle,
            @"trackArtist": trackArtist,
            @"trackIdentityBasis": observed[deck][@"trackIdentityBasis"] ? observed[deck][@"trackIdentityBasis"] : @"unavailable",
          }];
        }

        NSData *signatureData = [NSJSONSerialization dataWithJSONObject:decks options:0 error:nil];
        NSString *signature = [[NSString alloc] initWithData:signatureData encoding:NSUTF8StringEncoding];
        if (![signature isEqualToString:lastSignature] || now - lastEmit >= 1.0) {
          Emit(@"rekordbox.deck-state", @{ @"decks": decks }, ++sequence);
          lastSignature = signature;
          lastEmit = now;
        }
        [NSThread sleepForTimeInterval:0.15];
      }
    }
  }
}
