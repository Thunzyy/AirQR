import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    namespace = "com.airqr.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.airqr.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        // The Rust core currently does not build reliably for armeabi-v7a
        // because raptorq hits unstable ARM NEON intrinsics there. Keep the
        // Android app aligned with the ABIs we actually ship.
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"].toString()
                keyPassword = keystoreProperties["keyPassword"].toString()
                storeFile = rootProject.file(keystoreProperties["storeFile"].toString())
                storePassword = keystoreProperties["storePassword"].toString()
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

flutter {
    source = "../.."
}

tasks.register<Exec>("cargoBuild") {
    val crateDir = project.projectDir.resolve("../../rust")
    val jniLibsDir = project.projectDir.resolve("src/main/jniLibs")

    val ndkDir = System.getenv("ANDROID_NDK_HOME") ?: "${System.getenv("ANDROID_HOME")}/ndk/28.2.13676358"

    environment("CC_aarch64_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android34-clang.cmd")
    environment("AR_aarch64_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe")
    environment("CC_armv7_linux_androideabi", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/armv7a-linux-androideabi34-clang.cmd")
    environment("AR_armv7_linux_androideabi", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe")
    environment("CC_i686_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/i686-linux-android34-clang.cmd")
    environment("AR_i686_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe")
    environment("CC_x86_64_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/x86_64-linux-android34-clang.cmd")
    environment("AR_x86_64_linux_android", "$ndkDir/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe")

    workingDir(crateDir)
    // Keep the manual fallback aligned with the release builder.
    commandLine("cargo", "ndk", "-t", "arm64-v8a", "-t", "x86_64", "-o", jniLibsDir.absolutePath, "build", "--release")
}

// Temporarily disabled - using pre-built .so files
// tasks.whenTaskAdded {
//     if (name == "mergeDebugJniLibFolders" || name == "mergeReleaseJniLibFolders") {
//         dependsOn("cargoBuild")
//     }
// }
