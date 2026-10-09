package expo.modules.onboardingview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OnboardingViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("StaySoundOnboardingView")
        View(OnboardingView::class) {
            Events("onAction")
            Prop("initialState") { view: OnboardingView, value: String -> view.initialize(value) }
            Prop("replies") { view: OnboardingView, value: String -> view.replies(value) }
            Prop("appearance") { view: OnboardingView, value: Map<String, String> -> view.appearance(value) }
            Prop("logo") { view: OnboardingView, value: String -> view.logo(value) }
            Prop("topInset") { view: OnboardingView, value: Double -> view.topInset(value) }
            Prop("bottomInset") { view: OnboardingView, value: Double -> view.bottomInset(value) }
        }
    }
}
