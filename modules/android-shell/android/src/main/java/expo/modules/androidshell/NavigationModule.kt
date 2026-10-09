package expo.modules.androidshell

import android.view.View
import android.widget.FrameLayout
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class NavigationModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundNavigation")
        AsyncFunction("navigate") { path: String, mode: String -> NavigationHostRegistry.host?.navigate(path, mode) }.runOnQueue(Queues.MAIN)
        AsyncFunction("back") { NavigationHostRegistry.host?.back() }.runOnQueue(Queues.MAIN)
        AsyncFunction("player") { visible: Boolean -> NavigationHostRegistry.host?.player(visible) }.runOnQueue(Queues.MAIN)
        AsyncFunction("snapshot") { NavigationHostRegistry.host?.publish() }.runOnQueue(Queues.MAIN)
        OnNewIntent { intent ->
            val link = intent.dataString
            if (link != null && Destination.parse(link) != null) {
                appContext.currentActivity?.runOnUiThread {
                    appContext.currentActivity?.intent = intent
                    val host = NavigationHostRegistry.host
                    if (host == null) NavigationHostRegistry.pendingLink = link else host.navigate(link, "navigate")
                }
            }
        }
        View(NavigationHostView::class) {
            Events("onState")
            Prop("ready") { view: NavigationHostView, value: Boolean -> view.setReady(value) }
            Prop("onboardingRequired") { view: NavigationHostView, value: Boolean -> view.setOnboarding(value) }
            Prop("playerExpanded") { view: NavigationHostView, value: Boolean -> view.setPlayerExpanded(value) }
            Prop("appearance") { view: NavigationHostView, value: Map<String, String> -> view.setAppearance(value) }
            Prop("labels") { view: NavigationHostView, value: Map<String, String> -> view.setLabels(value) }
            Prop("sideInsets") { view: NavigationHostView, value: Map<String, Double> -> view.setSideInsets(value) }
            Prop("bottomInset") { view: NavigationHostView, value: Double -> view.setBottomInset(value) }
            GroupView<NavigationHostView> {
                AddChildView { parent: NavigationHostView, child: View, index: Int ->
                    parent.content.addView(child, index, FrameLayout.LayoutParams(-1, -1)); parent.updateVisibility()
                }
                GetChildCount { parent -> parent.content.childCount }
                GetChildViewAt { parent: NavigationHostView, index: Int -> parent.content.getChildAt(index) }
                RemoveChildViewAt { parent, index -> parent.content.removeViewAt(index) }
            }
        }
    }
}
class NavigationSlotModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundNavigationSlot")
        View(NavigationSlotView::class) {
            Prop("entryKey") { view: NavigationSlotView, value: String -> view.entryKey = value }
            GroupView<NavigationSlotView> {
                AddChildView { parent: NavigationSlotView, child: View, index: Int -> parent.content.addView(child, index, FrameLayout.LayoutParams(-1, -1)) }
                GetChildCount { parent -> parent.content.childCount }
                GetChildViewAt { parent: NavigationSlotView, index: Int -> parent.content.getChildAt(index) }
                RemoveChildViewAt { parent, index -> parent.content.removeViewAt(index) }
            }
        }
    }
}
