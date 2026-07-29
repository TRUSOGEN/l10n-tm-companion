/**
 * L10n TM Companion 安装进度窗口。
 *
 * 该 helper 由 Installer.app 启动，定时读取安装脚本写入的 `百分比|说明` 文件，
 * 在独立的原生 macOS 窗口中显示确定性进度；完成文件出现后自动关闭。它不执行
 * 安装、不读取凭证，也不拥有文件写权限，安装失败仍由主启动器忠实处理。
 */

#import <Cocoa/Cocoa.h>

/** 管理进度窗口、状态文件轮询和安装结束后的自动退出。 */
@interface L10nProgressController : NSObject <NSApplicationDelegate>

@property(nonatomic, copy) NSString *progressPath;
@property(nonatomic, copy) NSString *donePath;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSProgressIndicator *progressIndicator;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSTimer *timer;
@property(nonatomic, assign) BOOL finishing;

- (instancetype)initWithProgressPath:(NSString *)progressPath
                            donePath:(NSString *)donePath;

@end

@implementation L10nProgressController

/** 保存两个只读状态文件路径，窗口在 applicationDidFinishLaunching 中创建。 */
- (instancetype)initWithProgressPath:(NSString *)progressPath
                            donePath:(NSString *)donePath {
  self = [super init];
  if (self) {
    _progressPath = [progressPath copy];
    _donePath = [donePath copy];
    _finishing = NO;
  }
  return self;
}

/** 创建简洁的原生进度窗口并开始轮询安装状态。 */
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  NSRect frame = NSMakeRect(0, 0, 520, 164);
  self.window = [[NSWindow alloc]
      initWithContentRect:frame
                styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable)
                  backing:NSBackingStoreBuffered
                    defer:NO];
  self.window.title = @"正在安装 L10n TM Companion";
  self.window.releasedWhenClosed = NO;
  [self.window center];

  NSTextField *title = [NSTextField labelWithString:@"正在准备 Chrome 插件…"];
  title.font = [NSFont boldSystemFontOfSize:16.0];
  title.frame = NSMakeRect(28, 105, 464, 28);
  [self.window.contentView addSubview:title];

  self.statusLabel = [NSTextField labelWithString:@"检查安装包"];
  self.statusLabel.frame = NSMakeRect(28, 70, 464, 24);
  self.statusLabel.textColor = [NSColor secondaryLabelColor];
  [self.window.contentView addSubview:self.statusLabel];

  self.progressIndicator = [[NSProgressIndicator alloc]
      initWithFrame:NSMakeRect(28, 38, 464, 16)];
  self.progressIndicator.indeterminate = NO;
  self.progressIndicator.minValue = 0;
  self.progressIndicator.maxValue = 100;
  self.progressIndicator.doubleValue = 3;
  [self.window.contentView addSubview:self.progressIndicator];

  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  self.timer = [NSTimer scheduledTimerWithTimeInterval:0.2
                                                target:self
                                              selector:@selector(refreshProgress:)
                                              userInfo:nil
                                               repeats:YES];
}

/** 读取最新进度；done 文件出现后展示最终状态并在短暂停留后退出。 */
- (void)refreshProgress:(NSTimer *)timer {
  (void)timer;
  NSString *progress = [NSString stringWithContentsOfFile:self.progressPath
                                                  encoding:NSUTF8StringEncoding
                                                     error:nil];
  if (progress.length > 0) {
    NSArray<NSString *> *parts = [progress componentsSeparatedByString:@"|"];
    if (parts.count >= 2) {
      self.progressIndicator.doubleValue = [parts.firstObject doubleValue];
      self.statusLabel.stringValue = parts[1];
    }
  }

  if (self.finishing || ![[NSFileManager defaultManager] fileExistsAtPath:self.donePath]) {
    return;
  }
  self.finishing = YES;
  NSString *status = [NSString stringWithContentsOfFile:self.donePath
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
  BOOL succeeded = status.integerValue == 0;
  self.progressIndicator.doubleValue = succeeded ? 100 : self.progressIndicator.doubleValue;
  self.statusLabel.stringValue = succeeded
      ? @"安装准备完成，即将打开 Chrome 扩展页"
      : @"安装没有完成，即将打开错误说明";
  [self.timer invalidate];
  [self performSelector:@selector(finishAndExit) withObject:nil afterDelay:0.8];
}

/** 关闭窗口并终止只负责展示进度的 helper。 */
- (void)finishAndExit {
  [self.window orderOut:nil];
  [NSApp terminate:nil];
}

@end

/** 支持构建后无 GUI 自检；正常模式要求 progress 和 done 两个文件参数。 */
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
      puts("progress-helper-ok");
      return 0;
    }
    if (argc != 3) {
      fputs("usage: l10n-progress <progress-file> <done-file>\n", stderr);
      return 2;
    }
    NSApplication *application = [NSApplication sharedApplication];
    application.activationPolicy = NSApplicationActivationPolicyAccessory;
    L10nProgressController *controller = [[L10nProgressController alloc]
        initWithProgressPath:[NSString stringWithUTF8String:argv[1]]
                    donePath:[NSString stringWithUTF8String:argv[2]]];
    application.delegate = controller;
    [application run];
  }
  return 0;
}
