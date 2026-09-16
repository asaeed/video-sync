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

static void CollectBPMCandidates(AXUIElementRef element, NSInteger depth, NSMutableArray *elements) {
  if (depth >= 20) return;
  NSString *role = StringAttribute(element, kAXRoleAttribute);
  if ([role isEqualToString:(__bridge NSString *)kAXStaticTextRole] || IsDeckBPMField(element)) {
    [elements addObject:CFBridgingRelease(CFRetain(element))];
  }
  NSArray *children = CopyAttribute(element, kAXChildrenAttribute);
  for (id child in children) {
    CollectBPMCandidates((__bridge AXUIElementRef)child, depth + 1, elements);
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

static NSRunningApplication *FindRekordbox(void) {
  for (NSRunningApplication *candidate in NSWorkspace.sharedWorkspace.runningApplications) {
    if ([candidate.localizedName.lowercaseString isEqualToString:@"rekordbox"]) return candidate;
  }
  return nil;
}

static NSDictionary *ScanDeckElements(NSRunningApplication *rekordbox) {
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
  CollectBPMCandidates(application, 0, elements);
  CFRelease(application);

  NSMutableArray *records = [NSMutableArray array];
  for (id item in elements) {
    AXUIElementRef element = (__bridge AXUIElementRef)item;
    NSString *value = StringAttribute(element, kAXValueAttribute);
    NSPoint point = ElementPosition(element);
    if (!value || !isfinite(point.x) || !isfinite(point.y)) continue;
    [records addObject:@{
      @"value": value,
      @"x": @(point.x),
      @"y": @(point.y),
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
  double cueRegionTop = isfinite(windowPosition.y) ? windowPosition.y + 330.0 : 380.0;
  for (NSNumber *deck in @[ @1, @2 ]) {
    NSNumber *positionSeconds = nil;
    for (NSDictionary *clockRecord in records) {
      if (![clockRecord[@"deck"] isEqual:deck] || [clockRecord[@"y"] doubleValue] >= deckBandBottom) continue;
      NSNumber *wholeSeconds = ParseClockSeconds(clockRecord[@"value"]);
      if (!wholeSeconds) continue;
      for (NSDictionary *fractionRecord in records) {
        if (![fractionRecord[@"deck"] isEqual:deck]) continue;
        NSNumber *tenths = ParseTenths(fractionRecord[@"value"]);
        double xDistance = [fractionRecord[@"x"] doubleValue] - [clockRecord[@"x"] doubleValue];
        double yDistance = fabs([fractionRecord[@"y"] doubleValue] - [clockRecord[@"y"] doubleValue]);
        if (tenths && xDistance > 0 && xDistance < 80 && yDistance <= 4) {
          positionSeconds = @([wholeSeconds doubleValue] + [tenths doubleValue]);
          break;
        }
      }
      if (positionSeconds) break;
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
        NSNumber *cueSeconds = ParseClockSeconds(timeRecord[@"value"]);
        double xDistance = fabs([timeRecord[@"x"] doubleValue] - [cueRecord[@"x"] doubleValue]);
        double yDistance = [timeRecord[@"y"] doubleValue] - [cueRecord[@"y"] doubleValue];
        if (cueSeconds && xDistance <= 10 && yDistance >= 5 && yDistance <= 35) {
          [hotCues addObject:@{
            @"cueIndex": @(cueCharacter - 'A'),
            @"timeSeconds": cueSeconds,
          }];
          break;
        }
      }
    }
    [hotCues sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
      return [left[@"cueIndex"] compare:right[@"cueIndex"]];
    }];

    result[deck] = @{
      @"bpm": bestBPM[deck][@"bpm"] ? bestBPM[deck][@"bpm"] : NSNull.null,
      @"positionSeconds": positionSeconds ? positionSeconds : NSNull.null,
      @"hotCues": hotCues,
    };
  }
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

        NSDictionary *observed = ScanDeckElements(rekordbox);

        NSMutableArray *decks = [NSMutableArray array];
        for (NSNumber *deck in @[ @1, @2 ]) {
          id rawBPM = observed[deck][@"bpm"];
          NSNumber *bpm = [rawBPM isKindOfClass:NSNumber.class] ? rawBPM : nil;
          [decks addObject:@{
            @"deck": deck,
            @"loaded": @(bpm != nil),
            @"bpm": bpm ? bpm : NSNull.null,
            @"positionSeconds": observed[deck][@"positionSeconds"] ? observed[deck][@"positionSeconds"] : NSNull.null,
            @"hotCues": observed[deck][@"hotCues"] ? observed[deck][@"hotCues"] : @[],
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
