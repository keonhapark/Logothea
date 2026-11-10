import { usePrices } from '@terminal/renderer/hooks/usePrices'
import { useRoute } from './app/router'
import { BroadcastFeeds } from './app/broadcast'
import { SheetHost } from './app/sheet'
import TabBar from './components/TabBar'
import Intro from './components/Intro'
import Home from './screens/Home'
import Market from './screens/Market'
import Me from './screens/Me'
import CallScreen from './screens/call/CallScreen'

/** 시세 구독도 앱 전체에서 한 번만 건다(시장 표 · 지도 · 브리핑이 같은 store 를 읽는다). */
function PricesFeed() {
  usePrices()
  return null
}

export default function App() {
  const route = useRoute()
  return (
    <div className="app">
      <BroadcastFeeds />
      <PricesFeed />
      {route === '/' && <Home />}
      {route === '/market' && <Market />}
      {route === '/call' && <CallScreen />}
      {route === '/me' && <Me />}
      <TabBar route={route} />
      <SheetHost />
      <Intro />
    </div>
  )
}
