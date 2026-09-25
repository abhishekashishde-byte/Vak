import { useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

const backgroundVideos = [
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081127_0992a171-d3c6-4978-8213-0ec5df8b6d63.mp4',
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_092026_dd05b805-ea0f-40b2-8c52-332b88502592.mp4',
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081042_df7202bf-bd80-4b2b-bbc6-1f09ba2870e9.mp4',
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_080959_4cac5234-3573-464e-a5b7-76b94b8a7d61.mp4',
]

const scenes = [
  {
    label: 'Translate',
    videoIndex: 0,
    badge: 'Natural translation · meaning before words',
    headingTop: 'Say it your way.',
    headingBottom: 'Ana carries it across.',
    subtext: 'Type, paste or speak. Ana translates the meaning, tone and intent — so the result sounds natural instead of mechanical.',
    placeholder: 'Your email for early access',
  },
  {
    label: 'Meetings',
    videoIndex: 1,
    badge: 'Live meetings · transcript · translation · notes',
    headingTop: 'Stay in the meeting.',
    headingBottom: 'Even when language changes.',
    subtext: 'Follow the conversation live, read the transcript in your language, and leave with the important points and actions already captured.',
    placeholder: 'Get meeting access',
  },
  {
    label: 'Documents',
    videoIndex: 2,
    badge: 'PDF · Word · scanned documents',
    headingTop: 'Translate the words.',
    headingBottom: 'Keep the document.',
    subtext: 'Ana translates PDF and Word files while preserving headings, tables, images and the structure that makes the document usable.',
    placeholder: 'Get document access',
  },
  {
    label: 'Talk for Me',
    videoIndex: 3,
    badge: 'Talk for Me · early access',
    headingTop: 'Tell Ana what you need.',
    headingBottom: 'Ana helps say it.',
    subtext: 'For routine conversations, Ana can help carry the back-and-forth while important decisions, commitments and choices stay with you.',
    placeholder: 'Join Talk for Me early access',
  },
  {
    label: 'Camera',
    videoIndex: 0,
    badge: 'Camera · signs · menus · labels',
    headingTop: 'Point at it.',
    headingBottom: 'Understand it.',
    subtext: 'Use Ana on signs, menus, notices, labels and pictures. The translation stays connected to what you were looking at instead of becoming a detached block of text.',
    placeholder: 'Get camera translation access',
  },
  {
    label: 'Keyboard',
    videoIndex: 1,
    badge: 'Write · correct · reply · translate',
    headingTop: 'Ana where you already type.',
    headingBottom: 'No app switching.',
    subtext: 'Use Ana Keyboard to write from intent, correct a paragraph, translate what you type and reply from selected context without leaving the app you are already in.',
    placeholder: 'Get Ana Keyboard access',
  },
]

const navItems = [
  ['How It Works', '/meet-ana/#products'],
  ['Features', '/meet-ana/#keyboard'],
  ['Privacy', '/meet-ana/#privacy'],
  ['Early Access', '/?auth=login'],
]

const stats = [
  'Text · Voice · Camera',
  'PDF · Word',
  'Meetings · Live',
  'Privacy-first',
]

function App() {
  const [activeScene, setActiveScene] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const cooldownRef = useRef<number | null>(null)

  const activeContent = scenes[activeScene]
  const activeVideoIndex = activeContent.videoIndex
  const darkMode = activeVideoIndex === 2
  const heroColor = darkMode ? '#182C41' : '#ffffff'

  const switchScene = (index: number) => {
    if (index === activeScene || isTransitioning) return

    setActiveScene(index)
    setIsTransitioning(true)

    if (cooldownRef.current) window.clearTimeout(cooldownRef.current)
    cooldownRef.current = window.setTimeout(() => {
      setIsTransitioning(false)
      cooldownRef.current = null
    }, 1000)
  }

  const handleAccess = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    window.location.href = '/?auth=login'
  }

  return (
    <section className="relative h-screen w-full overflow-hidden bg-black">
      <div className="absolute inset-0 z-0">
        {backgroundVideos.map((url, index) => (
          <video
            key={url}
            className={
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ease-in-out ' +
              (activeVideoIndex === index ? 'opacity-100' : 'opacity-0')
            }
            autoPlay
            muted
            loop
            playsInline
            preload={index === 0 ? 'auto' : 'metadata'}
            aria-hidden={activeVideoIndex !== index}
          >
            <source src={url} type="video/mp4" />
          </video>
        ))}
      </div>

      <div className="train-window absolute inset-0 z-[1] pointer-events-none select-none" aria-hidden="true">
        <div className="train-ceiling" />
        <div className="train-side train-side-left" />
        <div className="train-side train-side-right" />
        <div className="train-window-rim" />
        <div className="train-sill" />
        <div className="train-reflection train-reflection-one" />
        <div className="train-reflection train-reflection-two" />
      </div>

      <div className="absolute inset-0 z-[1] bg-black/10 pointer-events-none" />

      <div className="relative z-[2] flex h-full flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] sm:px-7 sm:pb-6 sm:pt-6 lg:px-10 lg:pt-8">
        <nav className="flex items-center justify-between">
          <a
            href="/marketing"
            className="text-xl italic text-white sm:text-2xl"
            aria-label="Ana marketing home"
          >
            Ana
          </a>

          <div className="liquid-glass hidden items-center gap-1 rounded-full p-1.5 md:flex">
            {navItems.map(([label, href]) => (
              <a
                key={label}
                href={href}
                className="px-3 py-2 text-sm text-white/90 transition-colors hover:text-white"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                {label}
              </a>
            ))}
            <a
              href="/?auth=login"
              className="ml-1 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              Get Started
            </a>
          </div>

          <button
            className="liquid-glass relative flex h-11 w-11 items-center justify-center rounded-full md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <Menu
              size={20}
              className={
                'absolute text-white transition-all duration-300 ' +
                (menuOpen ? 'rotate-90 scale-75 opacity-0' : 'rotate-0 scale-100 opacity-100')
              }
            />
            <X
              size={20}
              className={
                'absolute text-white transition-all duration-300 ' +
                (menuOpen ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-75 opacity-0')
              }
            />
          </button>
        </nav>

        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center text-center transition-colors duration-700"
          style={{ color: heroColor }}
        >
          <div key={activeScene} className="content-enter flex flex-col items-center">
            <div
              className="liquid-glass rounded-full px-4 py-2 text-[10px] sm:text-xs"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              {activeContent.badge}
            </div>

            <h1 className="mt-5 max-w-4xl text-4xl leading-[1.02] tracking-[-0.025em] sm:mt-6 sm:text-5xl md:text-7xl lg:text-[5.5rem] lg:leading-[1.0]">
              {activeContent.headingTop}
              <br />
              {activeContent.headingBottom}
            </h1>

            <p
              className="mt-4 max-w-xl text-sm leading-relaxed opacity-80 sm:mt-5 sm:text-base"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              {activeContent.subtext}
            </p>

            <form
              onSubmit={handleAccess}
              className="liquid-glass mt-5 flex w-full max-w-[320px] items-center rounded-full p-1.5 sm:mt-6 sm:max-w-sm"
            >
              <input
                type="email"
                placeholder={activeContent.placeholder}
                aria-label="Your email"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:opacity-55"
                style={{ fontFamily: 'system-ui, sans-serif', color: heroColor }}
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-white px-4 py-2.5 text-xs font-medium text-slate-950 sm:text-sm"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                Get Early Access
              </button>
            </form>
          </div>

          <div
            className="scene-switcher mt-5 flex w-full max-w-full flex-nowrap items-center gap-x-5 overflow-x-auto px-1 pb-1 text-[11px] sm:mt-6 sm:justify-center sm:gap-x-6 sm:text-sm"
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            {scenes.map((scene, index) => (
              <button
                key={scene.label}
                type="button"
                onClick={() => switchScene(index)}
                className={
                  'shrink-0 border-b pb-1.5 transition-all duration-300 ' +
                  (activeScene === index
                    ? 'border-current opacity-100'
                    : 'border-transparent opacity-50 hover:opacity-80')
                }
                disabled={isTransitioning && index !== activeScene}
              >
                {scene.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pb-1 text-center text-[10px] text-white/70 sm:gap-x-4 sm:text-sm"
          style={{ fontFamily: 'system-ui, sans-serif' }}
        >
          {stats.map((stat, index) => (
            <div key={stat} className="flex items-center gap-x-3 sm:gap-x-4">
              <span>{stat}</span>
              {index < stats.length - 1 && (
                <span className="hidden text-white/35 sm:inline">|</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className={
          'fixed inset-0 z-50 md:hidden transition-all duration-500 ' +
          (menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0')
        }
        style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}
      >
        <button
          aria-label="Close mobile menu"
          className="absolute inset-0 h-full w-full bg-black/60 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />

        <div className="relative flex h-full flex-col items-center justify-center gap-7 px-6">
          {navItems.map(([label, href], index) => (
            <a
              key={label}
              href={href}
              onClick={() => setMenuOpen(false)}
              className={
                'text-3xl text-white transition-all duration-500 ' +
                (menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0')
              }
              style={{
                transitionDelay: menuOpen ? `${100 + index * 50}ms` : '0ms',
                transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
              }}
            >
              {label}
            </a>
          ))}

          <a
            href="/?auth=login"
            onClick={() => setMenuOpen(false)}
            className={
              'mt-3 rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-950 transition-all duration-500 ' +
              (menuOpen ? 'scale-100 opacity-100' : 'scale-90 opacity-0')
            }
            style={{
              fontFamily: 'system-ui, sans-serif',
              transitionDelay: menuOpen ? '300ms' : '0ms',
              transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            Get Started
          </a>
        </div>
      </div>
    </section>
  )
}

export default App
