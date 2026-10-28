import AppKit

final class MarkdownHandler: NSObject, NSApplicationDelegate {
    private var pending = 0

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            let process = Process()
            guard let node = Bundle.main.object(forInfoDictionaryKey: "RexMarkdownNode") as? String,
                  let script = Bundle.main.object(forInfoDictionaryKey: "RexMarkdownScript") as? String,
                  let logPath = Bundle.main.object(forInfoDictionaryKey: "RexMarkdownLog") as? String else {
                NSLog("Rex Markdown: missing installation paths")
                application.terminate(nil)
                return
            }
            do {
                let log = try FileHandle(forWritingTo: URL(fileURLWithPath: logPath))
                try log.seekToEnd()
                process.executableURL = URL(fileURLWithPath: node)
                process.arguments = [script, url.absoluteString]
                process.standardOutput = log
                process.standardError = log
                process.terminationHandler = { [weak self] _ in
                    try? log.close()
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        self.pending -= 1
                        if self.pending == 0 { application.terminate(nil) }
                    }
                }
                pending += 1
                do {
                    try process.run()
                } catch {
                    pending -= 1
                    try log.close()
                    throw error
                }
            } catch {
                NSLog("Rex Markdown: %@", error.localizedDescription)
                if pending == 0 { application.terminate(nil) }
            }
        }
    }
}

let application = NSApplication.shared
let handler = MarkdownHandler()
application.delegate = handler
application.setActivationPolicy(.prohibited)
application.run()
