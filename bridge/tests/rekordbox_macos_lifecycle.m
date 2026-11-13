#define main VideoSyncAdapterMain
#include "../src/rekordbox_macos_adapter.m"
#undef main

static NSRunningApplication *FixtureApplication(NSString *identifier) {
  for (NSRunningApplication *application in NSWorkspace.sharedWorkspace.runningApplications) {
    if ([application.bundleIdentifier isEqualToString:identifier]) return application;
  }
  return nil;
}

static BOOL WaitForFixture(NSString *identifier, BOOL running) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  do {
    if ((FixtureApplication(identifier) != nil) == running) return YES;
    WaitForNextPoll(0.05);
  } while (deadline.timeIntervalSinceNow > 0);
  return NO;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc > 1 && strcmp(argv[1], "--fixture") == 0) {
      [NSApplication sharedApplication];
      [NSTimer scheduledTimerWithTimeInterval:8 repeats:NO block:^(NSTimer *timer) { (void)timer; [NSApp terminate:nil]; }];
      [NSApp run];
      return 0;
    }
    NSString *identifier = [@"com.asaeed.video-sync-lifecycle-" stringByAppendingString:NSUUID.UUID.UUIDString];
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    NSString *bundle = [root stringByAppendingPathComponent:@"AdapterFixture.app"];
    NSString *executableDirectory = [bundle stringByAppendingPathComponent:@"Contents/MacOS"];
    NSFileManager *files = NSFileManager.defaultManager;
    [files createDirectoryAtPath:executableDirectory withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *executable = [executableDirectory stringByAppendingPathComponent:@"AdapterFixture"];
    [files copyItemAtPath:[NSString stringWithUTF8String:argv[0]] toPath:executable error:nil];
    [@{ @"CFBundleIdentifier": identifier, @"CFBundleName": @"Video Sync Adapter Test", @"CFBundleExecutable": @"AdapterFixture", @"CFBundlePackageType": @"APPL", @"LSUIElement": @YES } writeToFile:[bundle stringByAppendingPathComponent:@"Contents/Info.plist"] atomically:YES];

    // Prime NSWorkspace before the app exists, as when the relay starts at login.
    if (FixtureApplication(identifier)) return 1;
    for (NSInteger cycle = 0; cycle < 2; cycle++) {
      NSTask *launch = [[NSTask alloc] init];
      launch.launchPath = @"/usr/bin/open";
      launch.arguments = @[ @"-g", @"-n", bundle, @"--args", @"--fixture" ];
      [launch launch];
      if (!WaitForFixture(identifier, YES)) {
        fprintf(stderr, "NSWorkspace did not discover an app launched after polling began (cycle %ld)\n", (long)cycle);
        return 1;
      }
      NSRunningApplication *fixture = FixtureApplication(identifier);
      [fixture terminate];
      if (!WaitForFixture(identifier, NO)) {
        [fixture forceTerminate];
        fprintf(stderr, "NSWorkspace did not discover the app exit\n");
        return 1;
      }
    }
    puts("adapter discovers launch, exit, and relaunch after starting first");
    return 0;
  }
}
