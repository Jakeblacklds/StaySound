package expo.modules.corestorage

import android.content.pm.PackageManager
import app.staysound.core.data.StorageAuthority
import app.staysound.core.data.StorageBootstrap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking

/**
 * Persistence boundary for the JavaScript stores. Kotlin migration APIs are intentionally not exported to JS.
 * Builds with `app.staysound.NATIVE_DATA` set store everything in Room/DataStore; otherwise the legacy JSON files
 * remain authoritative (and any earlier native data is exported back to them first).
 */
class CoreStorageModule : Module() {
    private var session: StorageAuthority? = null
    private val monitor = Any()
    private var destroyed = false

    private fun nativeDataEnabled(): Boolean {
        val context = checkNotNull(appContext.reactContext)
        @Suppress("DEPRECATION")
        val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        return info.metaData?.getBoolean(NATIVE_DATA_KEY, false) == true
    }
    private fun storage(): StorageAuthority = synchronized(monitor) {
        check(!destroyed) { "Storage module destroyed" }
        session ?: runBlocking { StorageBootstrap.open(checkNotNull(appContext.reactContext), nativeDataEnabled()) }.also { session = it }
    }
    override fun definition() = ModuleDefinition {
        Name("StaySoundCoreStorage")
        // Expo's async worker serializes these calls. Session owns the cross-runtime file lease.
        AsyncFunction("getItem") { name: String -> runBlocking { storage().getItem(name) } }
        AsyncFunction("setItem") { name: String, value: String -> runBlocking { storage().setItem(name, value) } }
        AsyncFunction("removeItem") { name: String -> runBlocking { storage().removeItem(name) } }
        OnDestroy { synchronized(monitor) { destroyed = true; runBlocking { session?.close() }; session = null } }
    }
    private companion object { const val NATIVE_DATA_KEY = "app.staysound.NATIVE_DATA" }
}
