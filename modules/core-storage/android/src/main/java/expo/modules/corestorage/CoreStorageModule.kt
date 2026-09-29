package expo.modules.corestorage

import app.staysound.core.data.LegacyStorageSession
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking

/** Temporary compatibility boundary. Kotlin migration APIs are intentionally not exported to JS. */
class CoreStorageModule : Module() {
    private var session: LegacyStorageSession? = null
    private val monitor = Any()
    private var destroyed = false
    private fun storage(): LegacyStorageSession = synchronized(monitor) {
        check(!destroyed) { "Storage module destroyed" }
        session ?: LegacyStorageSession.open(checkNotNull(appContext.reactContext).filesDir).also { session = it }
    }
    override fun definition() = ModuleDefinition {
        Name("StaySoundCoreStorage")
        // Expo's async worker serializes these calls. Session owns the cross-runtime file lease.
        AsyncFunction("getItem") { name: String -> runBlocking { storage().getItem(name) } }
        AsyncFunction("setItem") { name: String, value: String -> runBlocking { storage().setItem(name, value) } }
        AsyncFunction("removeItem") { name: String -> runBlocking { storage().removeItem(name) } }
        OnDestroy { synchronized(monitor) { destroyed = true; runBlocking { session?.close() }; session = null } }
    }
}
