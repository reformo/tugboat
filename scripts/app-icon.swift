import AppKit
import ImageIO

func iconError(_ message: String) -> NSError {
    NSError(domain: "Tugboat.AppIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

@discardableResult
func run(_ tool: String, _ arguments: [String], captureOutput: Bool = false) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: tool)
    process.arguments = arguments
    let pipe = captureOutput ? Pipe() : nil
    if let pipe { process.standardOutput = pipe }
    try process.run()
    let data = pipe?.fileHandleForReading.readDataToEndOfFile() ?? Data()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw iconError("\(tool) exited with \(process.terminationStatus)") }
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 1 || (arguments.count == 2 && arguments[1] == "--update-bundle-assets") else {
    throw iconError("Usage: swift scripts/app-icon.swift OUTPUT [--update-bundle-assets]")
}
let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let tauri = project.appendingPathComponent("src-tauri")
let icons = tauri.appendingPathComponent("icons")
let output = URL(fileURLWithPath: arguments[0], isDirectory: true)
let document = output.appendingPathComponent("AppIcon.icon")
let assets = document.appendingPathComponent("Assets")
try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)

let artwork = try Data(contentsOf: project.appendingPathComponent("tugboat-logo-1024.png"))
try artwork.write(to: assets.appendingPathComponent("shield.png"), options: .atomic)
let settings: [String: Any] = [
    "fill": ["solid": "srgb:0.969,0.976,0.984,1"],
    "groups": [[
        "name": "shield",
        "layers": [["name": "shield", "image-name": "shield.png", "glass": false]],
        "specular": false,
        "shadow": ["kind": "neutral", "opacity": 0],
        "translucency": ["enabled": false, "value": 0.5]
    ]],
    "supported-platforms": ["squares": ["macOS"]]
]
try JSONSerialization.data(withJSONObject: settings, options: [.prettyPrinted, .sortedKeys])
    .write(to: document.appendingPathComponent("icon.json"), options: .atomic)

let config = try Data(contentsOf: tauri.appendingPathComponent("tauri.conf.json"))
let root = try JSONSerialization.jsonObject(with: config) as? [String: Any]
guard let bundle = root?["bundle"] as? [String: Any], let mac = bundle["macOS"] as? [String: Any],
      let minimum = mac["minimumSystemVersion"] as? String else { throw iconError("Missing macOS deployment target") }
try run("/usr/bin/xcrun", [
    "actool", "--compile", output.path, "--platform", "macosx", "--target-device", "mac",
    "--minimum-deployment-target", minimum, "--app-icon", "AppIcon",
    "--output-partial-info-plist", output.appendingPathComponent("Info.plist").path, document.path
])

let developerDir = try run("/usr/bin/xcode-select", ["-p"], captureOutput: true)
let composer = URL(fileURLWithPath: developerDir).deletingLastPathComponent()
    .appendingPathComponent("Applications/Icon Composer.app/Contents/Executables/ictool")
let preview = output.appendingPathComponent("Default.png")
try run(composer.path, [document.path, "--export-image", "--output-file", preview.path, "--platform", "macOS",
                        "--rendition", "Default", "--width", "1024", "--height", "1024", "--scale", "1"])
guard let source = CGImageSourceCreateWithURL(preview as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { throw iconError("Cannot read the rendered icon") }
for size in [16, 32, 64, 128, 256, 512, 1024] {
    guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 4 * size,
                                  space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw iconError("Cannot create the \(size) px bitmap")
    }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    guard let raster = context.makeImage(),
          let png = NSBitmapImageRep(cgImage: raster).representation(using: .png, properties: [:]) else {
        throw iconError("Cannot encode the \(size) px PNG")
    }
    try png.write(to: output.appendingPathComponent("icon-\(size).png"), options: .atomic)
}

if arguments.contains("--update-bundle-assets") {
    for (source, destination) in [("Assets.car", "Assets.car"), ("AppIcon.icns", "icon.icns"), ("icon-512.png", "icon.png")] {
        try Data(contentsOf: output.appendingPathComponent(source))
            .write(to: icons.appendingPathComponent(destination), options: .atomic)
    }
}
