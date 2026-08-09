import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // O UIKit carrega automaticamente o Main.storyboard e associa a Window
        // ao root view controller (CAPBridgeViewController) sem requerer código adicional.
        guard let _ = (scene as? UIWindowScene) else { return }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }
}
