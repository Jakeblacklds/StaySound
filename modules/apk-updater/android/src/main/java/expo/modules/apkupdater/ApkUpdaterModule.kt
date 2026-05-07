package expo.modules.apkupdater

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Locale

class ApkUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ApkUpdater")

    Function("isAvailable") {
      true
    }

    Function("canRequestPackageInstalls") {
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        return@Function false
      }

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return@Function true
      }

      context.packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("openUnknownSourcesSettings") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("React context is not available.")

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return@AsyncFunction null
      }

      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      try {
        context.startActivity(intent)
      } catch (error: ActivityNotFoundException) {
        throw IllegalStateException("Could not open unknown sources settings.", error)
      }
    }

    AsyncFunction("installDownloadedApk") { fileUri: String ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("React context is not available.")
      val file = resolveFile(fileUri)
      if (!file.exists()) {
        throw IllegalArgumentException("APK file does not exist: ${file.absolutePath}")
      }

      val installUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        file
      )

      val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
        data = installUri
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
      }

      try {
        context.startActivity(intent)
      } catch (error: ActivityNotFoundException) {
        throw IllegalStateException("Could not launch the package installer.", error)
      }
    }

    AsyncFunction("getInstalledVersion") {
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("React context is not available.")
      val packageInfo = getInstalledPackageInfo(context.packageManager, context.packageName)
      mapPackageInfo(context.packageName, packageInfo, context)
    }

    AsyncFunction("inspectDownloadedApk") { fileUri: String ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("React context is not available.")
      val file = resolveFile(fileUri)
      if (!file.exists()) {
        throw IllegalArgumentException("APK file does not exist: ${file.absolutePath}")
      }

      val packageInfo = getArchivePackageInfo(context.packageManager, file.absolutePath)
        ?: throw IllegalStateException("Could not inspect downloaded APK.")

      mapOf(
        "packageName" to (packageInfo.packageName ?: ""),
        "versionCode" to packageInfo.compatVersionCode(),
        "versionName" to (packageInfo.versionName ?: ""),
        "fileSha256" to sha256ForFile(file),
        "signerSha256" to signerSha256(packageInfo),
      )
    }
  }

  private fun resolveFile(fileUri: String): File {
    val trimmed = fileUri.trim()
    if (trimmed.isEmpty()) {
      throw IllegalArgumentException("fileUri cannot be empty.")
    }

    val parsed = Uri.parse(trimmed)
    val path = when {
      parsed.scheme.equals("file", ignoreCase = true) -> parsed.path
      parsed.scheme.isNullOrBlank() -> trimmed
      else -> null
    } ?: throw IllegalArgumentException("Unsupported APK path: $fileUri")

    return File(path)
  }

  private fun getInstalledPackageInfo(packageManager: PackageManager, packageName: String): PackageInfo {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageInfo(
        packageName,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
    }
  }

  private fun getArchivePackageInfo(packageManager: PackageManager, apkPath: String): PackageInfo? {
    val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      packageManager.getPackageArchiveInfo(
        apkPath,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      @Suppress("DEPRECATION")
      packageManager.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNING_CERTIFICATES)
    } else {
      @Suppress("DEPRECATION")
      packageManager.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES)
    }

    packageInfo?.applicationInfo?.sourceDir = apkPath
    packageInfo?.applicationInfo?.publicSourceDir = apkPath
    return packageInfo
  }

  private fun mapPackageInfo(
    packageName: String,
    packageInfo: PackageInfo,
    context: android.content.Context
  ): Map<String, Any?> {
    return mapOf(
      "packageName" to packageName,
      "versionCode" to packageInfo.compatVersionCode(),
      "versionName" to (packageInfo.versionName ?: ""),
      "runtimeVersion" to context.getStringResourceSafely("expo_runtime_version"),
      "signerSha256" to signerSha256(packageInfo),
    )
  }

  private fun signerSha256(packageInfo: PackageInfo): List<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = packageInfo.signingInfo ?: return emptyList()
      if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
    } else {
      @Suppress("DEPRECATION")
      packageInfo.signatures ?: emptyArray()
    }

    return signatures.mapNotNull { signature ->
      runCatching {
        val certificate = CertificateFactory.getInstance("X509")
          .generateCertificate(signature.toByteArray().inputStream()) as X509Certificate
        sha256ForBytes(certificate.encoded)
      }.getOrNull()
    }.distinct()
  }

  private fun sha256ForFile(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(Locale.US, it) }
  }

  private fun sha256ForBytes(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(bytes)
    return digest.digest().joinToString("") { "%02x".format(Locale.US, it) }
  }

  private fun PackageInfo.compatVersionCode(): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      longVersionCode
    } else {
      @Suppress("DEPRECATION")
      versionCode.toLong()
    }
  }

  private fun android.content.Context.getStringResourceSafely(name: String): String? {
    val resourceId = resources.getIdentifier(name, "string", packageName)
    if (resourceId == 0) {
      return null
    }
    return getString(resourceId)
  }
}
