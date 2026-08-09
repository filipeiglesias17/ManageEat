import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { App as CapApp } from '@capacitor/app'
import { AppRoot } from './app'
import { initNetworkDiscovery, refreshConnection } from './lib/network-discovery'
import { isDarkActive } from './lib/theme'
import { configureStatusBarOverlay, syncStatusBarWithTheme } from './lib/native-chrome'
import { initKeyboardScrollIntoView } from './lib/keyboard'
import { checkForUpdate, notifyReady, clearPendingIfApplied } from './lib/ota'

if (Capacitor.isNativePlatform()) {
  void configureStatusBarOverlay()
  void syncStatusBarWithTheme(isDarkActive())
  void initKeyboardScrollIntoView()
}

initNetworkDiscovery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
)

if (Capacitor.isNativePlatform()) {
  const hideSplash = () => SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {})
  requestAnimationFrame(() => requestAnimationFrame(hideSplash))
  window.setTimeout(hideSplash, 2500)
  CapApp.addListener('resume', () => { refreshConnection(); checkForUpdate() })
  notifyReady()
  clearPendingIfApplied()
}
