package expo.modules.androidshell

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OverlayHostModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundOverlayHost")
        View(OverlayHostView::class) {
            Events("onAction")
            Prop("snapshot") { view: OverlayHostView, value: String -> view.setSnapshot(value) }
        }
    }
}
class ShellScreenModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundShellScreen")
        View(ShellScreenView::class) {
            Events("onAction")
            Prop("model") { view: ShellScreenView, value: String -> view.setModel(value) }
            Prop("lyrics") { view: ShellScreenView, value: String -> view.setLyrics(value) }
            Prop("active") { view: ShellScreenView, value: Boolean -> view.setActive(value) }
            Prop("positionMs") { view: ShellScreenView, value: Double -> view.position(value.toLong()) }
            Prop("topInset") { view: ShellScreenView, value: Double -> view.setTopInset(value) }
            Prop("bottomInset") { view: ShellScreenView, value: Double -> view.setBottomInset(value) }
        }
    }
}
