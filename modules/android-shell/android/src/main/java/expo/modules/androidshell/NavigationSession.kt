package expo.modules.androidshell

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

class NavigationModel : ViewModel() {
    var state = NavigationState()
    var initialized = false
}

/** ViewModel covers activity recreation; SavedStateRegistry covers a new process. */
internal object NavigationSession {
    const val SAVED_KEY = "staysound.kotlin.navigation.v1"
    fun attach(activity: ComponentActivity): NavigationModel {
        val holder = ViewModelProvider(activity)[NavigationModel::class.java]
        val savedBundle = activity.savedStateRegistry.consumeRestoredStateForKey(SAVED_KEY)
        val saved = savedBundle?.getString("navigation")
        if (!holder.initialized) {
            holder.state = NavigationState.restore(saved)
            holder.initialized = true
            // An old launch intent must not replay over a restored stack.
            val link = activity.intent?.dataString
            if (saved == null || link != savedBundle?.getString("intent")) {
                link?.let { Destination.parse(it)?.let { route -> holder.state.navigate(route, "navigate") } }
            }
        }
        activity.savedStateRegistry.registerSavedStateProvider(SAVED_KEY) { Bundle().apply {
            putString("navigation", holder.state.snapshot())
            putString("intent", activity.intent?.dataString)
        } }
        return holder
    }
    fun detach(activity: ComponentActivity) = activity.savedStateRegistry.unregisterSavedStateProvider(SAVED_KEY)
}
