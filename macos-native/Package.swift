// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StaySoundNative",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "StaySoundNative", targets: ["StaySoundNative"]),
    ],
    targets: [
        .executableTarget(
            name: "StaySoundNative",
            path: "Sources/StaySoundNative"
        ),
    ]
)
