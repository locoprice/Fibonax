import type { ReactElement, ReactNode } from 'react';
import { BrainIcon } from '@/components/shared/BrainIcon';
import { PromptIcon } from '@/components/shared/PromptIcon';
import { SnippetIcon } from '@/components/shared/SnippetIcon';
import {
  AnimationStage,
  Sprite,
  useSprite,
  Easing,
  interpolate,
  clamp,
} from '@/features/onboarding/anim/timeline';

/**
 * The Getting started animation, in five scenes that follow the user manual's
 * Quickstart: add Fibonax to Chrome and sign in, type a snippet's trigger and
 * fill its form, type `"""` for a prompt that carries a Brain, use the same
 * library on the phone, and the T. Every word and control on screen is one the
 * product shows today, with sample content that fits any industry.
 *
 * Self-contained illustration: inline styles and fixed 1280x720 coordinates
 * are intrinsic to the piece and don't follow the dashboard's Tailwind-token
 * rule. The stage stays light in both themes, like a video.
 */

/* Palette and type */
const AZURE = '#1B4FD8';
const AZURE_L = '#3D6FE8';
const AZURE_BG = '#EEF2FF';
const NAVY = '#101C39'; // mobile-navy
const NAVY_SOFT = '#203151'; // mobile-navy-soft
const NAVY_COPY = '#C1CBE0'; // mobile-navy-copy
const INK = '#18181B';
const INK_MUT = '#52525B';
const INK_SUB = '#71717A';
const LINE = '#E4E4E7';
const SOFT = '#FAFAFA';
const DESK = '#F4F3F1';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = Easing.easeInOutCubic;
const easeOut = Easing.easeOutCubic;
const back = Easing.easeOutBack;

/** 0 before `start`, 1 after `start + span`, eased in between. */
const appear = (lt: number, start: number, span = 0.4): number =>
  easeOut(clamp((lt - start) / span, 0, 1));

/** The first characters of `text` typed from `start`, one every `per` seconds. */
const typed = (text: string, lt: number, start: number, per: number): string =>
  text.slice(0, clamp(Math.floor((lt - start) / per), 0, text.length));

/* The Fibonax T: the same picture as the dashboard's BrandMark, as a mask. */
const T_MASK = 'url(/landing/leib-tour-icon.png) center / contain no-repeat';

function TMark({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <span
      style={{
        display: 'block',
        width: size,
        height: size,
        background: color,
        WebkitMask: T_MASK,
        mask: T_MASK,
      }}
    />
  );
}

/** The app icon: the white T on an azure tile. */
function AppIcon({ size, radius }: { size: number; radius?: number }): ReactElement {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.26),
        background: `linear-gradient(135deg, ${AZURE}, ${AZURE_L})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 6px 18px ${AZURE}44`,
        flexShrink: 0,
      }}
    >
      <TMark size={Math.round(size * 0.62)} color="#fff" />
    </div>
  );
}

/* Pointer, click ring and tap pulse */
function Cursor({ x, y, press }: { x: number; y: number; press?: boolean }): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 26,
        height: 26,
        transform: `translate(-3px,-2px) scale(${press ? 0.86 : 1})`,
        transformOrigin: '3px 3px',
        pointerEvents: 'none',
        zIndex: 60,
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.32))',
      }}
    >
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path
          d="M4 2l6.5 16 2.3-6.7 6.7-2.3L4 2z"
          fill="#fff"
          stroke={INK}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ClickRing({ x, y, t }: { x: number; y: number; t: number }): ReactElement | null {
  if (t < 0 || t > 0.42) return null;
  const p = clamp(t / 0.42, 0, 1);
  const r = lerp(4, 26, easeOut(p));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `2px solid ${AZURE}`,
        opacity: (1 - p) * 0.8,
        pointerEvents: 'none',
        zIndex: 55,
      }}
    />
  );
}

function TapPulse({ x, y, t }: { x: number; y: number; t: number }): ReactElement | null {
  if (t < 0 || t > 0.5) return null;
  const p = clamp(t / 0.5, 0, 1);
  const r = lerp(6, 30, easeOut(p));
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: AZURE,
        opacity: (1 - p) * 0.3,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    />
  );
}

/* Scene shell: crossfade and a gentle push-in */
function Scene({
  children,
  zoom = 0.02,
  bg = DESK,
}: {
  children: ReactNode;
  zoom?: number;
  bg?: string;
}): ReactElement {
  const { localTime: lt, duration: d } = useSprite();
  let op = 1;
  if (lt < 0.45) op = easeOut(clamp(lt / 0.45, 0, 1));
  else if (lt > d - 0.4) op = easeOut(clamp((d - lt) / 0.4, 0, 1));
  const sc = lerp(1, 1 + zoom, clamp(lt / d, 0, 1));
  return (
    <div style={{ position: 'absolute', inset: 0, background: bg, opacity: op, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${sc})`, transformOrigin: '50% 46%' }}>
        {children}
      </div>
    </div>
  );
}

/** The lower third: a short azure rule and one plain sentence. */
function Caption({ text, at, lt, y = 644 }: { text: string; at: number; lt: number; y?: number }): ReactElement | null {
  if (lt < at) return null;
  const e = appear(lt, at, 0.55);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: y,
        textAlign: 'center',
        opacity: e,
        transform: `translateY(${lerp(16, 0, e)}px)`,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 26, height: 3, borderRadius: 2, background: AZURE }} />
        <span style={{ fontFamily: FONT, fontSize: 36, fontWeight: 600, letterSpacing: '-0.5px', color: INK }}>{text}</span>
      </div>
    </div>
  );
}

/** A step number and label above a scene, the same place in every scene. */
function StepTag({ n, label, lt }: { n: number; label: string; lt: number }): ReactElement {
  const e = appear(lt, 0.2, 0.5);
  return (
    <div
      style={{
        position: 'absolute',
        left: 90,
        top: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity: e,
        transform: `translateX(${lerp(-12, 0, e)}px)`,
        zIndex: 45,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: AZURE, letterSpacing: '.5px' }}>
        STEP {n}
        <span style={{ color: INK_SUB }}> / 4</span>
      </span>
      <span style={{ width: 22, height: 3, borderRadius: 2, background: AZURE }} />
      <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: INK_MUT }}>{label}</span>
    </div>
  );
}

/** A floating menu row, as the extension's menus draw them. */
function MenuRow({
  icon,
  name,
  detail,
  active,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  active: boolean;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 9,
        background: active ? AZURE_BG : 'transparent',
      }}
    >
      <span style={{ color: AZURE, display: 'flex' }}>{icon}</span>
      <span style={{ fontFamily: FONT, fontSize: 14.5, fontWeight: 600, color: INK }}>{name}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: active ? AZURE : INK_SUB, marginLeft: 'auto' }}>{detail}</span>
    </div>
  );
}

function FloatingMenu({
  title,
  show,
  children,
  left,
  top,
  width = 360,
}: {
  title: string;
  show: number;
  children: ReactNode;
  left: number;
  top: number;
  width?: number;
}): ReactElement | null {
  if (show <= 0.001) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        background: '#fff',
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        padding: 6,
        boxShadow: '0 18px 44px rgba(16,28,57,.18), 0 3px 10px rgba(0,0,0,.06)',
        opacity: show,
        transform: `translateY(${lerp(8, 0, show)}px)`,
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 8px' }}>
        <TMark size={14} color={AZURE} />
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: INK_SUB }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ================================================================ */
/* SCENE 1: add Fibonax to Chrome, pin it, sign in                   */
/* ================================================================ */
function SceneInstall(): ReactElement {
  const { localTime: lt } = useSprite();
  const bx = 90;
  const by = 64;
  const bw = 1100;
  const bh = 548;

  // Pointer path: Add to Chrome, the puzzle, the pin, the T, Sign in.
  const T = [0, 1.1, 1.5, 2.2, 2.55, 2.95, 3.3, 3.75, 4.1, 4.55, 4.9, 7];
  const cx = interpolate(T, [1000, 1040, 1040, 1103, 1103, 1078, 1078, 1069, 1069, 1010, 1010, 1010], ease)(lt);
  const cy = interpolate(T, [640, 292, 292, 141, 141, 214, 214, 141, 141, 300, 300, 300], ease)(lt);
  const clicks = [1.5, 2.55, 3.3, 4.1, 4.9];
  const press = clicks.some((c) => lt >= c && lt < c + 0.14);

  const added = lt >= 1.5;
  const extMenu = lt >= 2.6 && lt < 3.4 ? appear(lt, 2.6, 0.2) : 0;
  const pinned = lt >= 3.3;
  const popup = lt >= 4.15 ? appear(lt, 4.15, 0.25) : 0;
  const signedIn = lt >= 4.95;

  const iconBtn = (child: ReactNode, key: string): ReactElement => (
    <div
      key={key}
      style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5F6368' }}
    >
      {child}
    </div>
  );
  const puzzle = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.4 13a2 2 0 1 0 0-4H18V6a2 2 0 0 0-2-2h-3v1.4a2 2 0 1 1-4 0V4H6a2 2 0 0 0-2 2v3h1.4a2 2 0 1 1 0 4H4v3a2 2 0 0 0 2 2h3v-1.4a2 2 0 1 1 4 0V20h3a2 2 0 0 0 2-2v-5z" />
    </svg>
  );

  return (
    <Scene>
      <StepTag n={1} label="Add Fibonax to Chrome" lt={lt} />
      <div
        style={{
          position: 'absolute',
          left: bx,
          top: by,
          width: bw,
          height: bh,
          background: '#fff',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(0,0,0,.16), 0 8px 24px rgba(0,0,0,.07)',
          border: `1px solid ${LINE}`,
        }}
      >
        {/* tab strip */}
        <div style={{ height: 42, background: '#DEE1E6', display: 'flex', alignItems: 'flex-end', padding: '0 10px', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', height: 32, borderRadius: '10px 10px 0 0', padding: '0 16px' }}>
            <AppIcon size={15} radius={4} />
            <span style={{ fontFamily: FONT, fontSize: 12.5, color: '#3C4043' }}>Fibonax · Chrome Web Store</span>
          </div>
        </div>
        {/* address bar */}
        <div style={{ height: 50, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
          <div style={{ flex: 1, height: 34, borderRadius: 17, background: '#F1F3F4', display: 'flex', alignItems: 'center', padding: '0 16px', fontFamily: FONT, fontSize: 13.5, color: '#5F6368' }}>
            chromewebstore.google.com/detail/<b style={{ color: INK, fontWeight: 600 }}>fibonax</b>
          </div>
          {pinned && (
            <div style={{ transform: `scale(${back(appear(lt, 3.3, 0.35))})`, display: 'flex' }}>
              {iconBtn(<AppIcon size={20} radius={5} />, 'pin')}
            </div>
          )}
          {iconBtn(puzzle, 'puzzle')}
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#5F6368', color: '#fff', fontFamily: FONT, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>A</div>
        </div>

        {/* listing */}
        <div style={{ display: 'flex', gap: 28, padding: '56px 64px' }}>
          <AppIcon size={112} radius={26} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 700, color: INK, letterSpacing: '-1px' }}>Fibonax</div>
            <div style={{ fontFamily: FONT, fontSize: 15, color: AZURE, marginTop: 4 }}>fibonax.com</div>
            <div style={{ fontFamily: FONT, fontSize: 18, color: INK_MUT, marginTop: 18, lineHeight: 1.5, maxWidth: 520 }}>
              Snippets, prompts and Brains in every text box. Type a shortcut, get the whole message.
            </div>
          </div>
          <div
            style={{
              alignSelf: 'flex-start',
              height: 46,
              padding: '0 26px',
              borderRadius: 23,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 600,
              background: added ? '#E8EAED' : AZURE,
              color: added ? INK_MUT : '#fff',
              marginTop: 18,
            }}
          >
            {added ? '✓ Added to Chrome' : 'Add to Chrome'}
          </div>
        </div>

        {/* extensions menu, with the pin */}
        {extMenu > 0 && (
          <div
            style={{
              position: 'absolute',
              right: 30,
              top: 92,
              width: 250,
              background: '#fff',
              border: `1px solid ${LINE}`,
              borderRadius: 12,
              padding: '10px 14px',
              boxShadow: '0 16px 40px rgba(0,0,0,.16)',
              opacity: extMenu,
            }}
          >
            <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: INK_SUB, marginBottom: 8 }}>Extensions</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppIcon size={22} radius={6} />
              <span style={{ fontFamily: FONT, fontSize: 14, color: INK, flex: 1 }}>Fibonax</span>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={pinned ? AZURE : '#5F6368'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.8V4h6v6.8l3 3.2H6l3-3.2z" />
              </svg>
            </div>
          </div>
        )}

        {/* the popup: sign in once */}
        {popup > 0 && (
          <div
            style={{
              position: 'absolute',
              right: 40,
              top: 96,
              width: 300,
              background: '#fff',
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              padding: 18,
              boxShadow: '0 20px 50px rgba(16,28,57,.2)',
              opacity: popup,
              transform: `translateY(${lerp(-6, 0, popup)}px)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TMark size={26} color={INK} />
              <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: INK }}>Fibonax</span>
            </div>
            <div style={{ fontFamily: FONT, fontSize: 13.5, color: INK_MUT, margin: '12px 0 14px', lineHeight: 1.45 }}>
              {signedIn ? 'Your snippets, prompts and Brains are ready.' : 'Sign in to use your library on any page.'}
            </div>
            <div
              style={{
                height: 40,
                borderRadius: 10,
                background: signedIn ? AZURE_BG : AZURE,
                color: signedIn ? AZURE : '#fff',
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {signedIn ? '✓ Signed in' : 'Sign in via dashboard'}
            </div>
          </div>
        )}

        <Cursor x={cx - bx} y={cy - by} press={press} />
        {clicks.map((c) => (
          <ClickRing key={c} x={cx - bx} y={cy - by} t={lt - c} />
        ))}
      </div>
      <Caption text="Add it once. Sign in once." at={5.3} lt={lt} />
    </Scene>
  );
}

/* ================================================================ */
/* SCENE 2: type a trigger, fill the form, insert                    */
/* ================================================================ */
const SNIPPET_TRIGGER = '::followup';

function SceneSnippet(): ReactElement {
  const { localTime: lt } = useSprite();
  const x = 250;
  const y = 70;
  const w = 780;

  const shortcut = typed(SNIPPET_TRIGGER, lt, 0.5, 0.08);
  const menu = lt >= 0.75 && lt < 1.95 ? appear(lt, 0.75, 0.25) : 0;
  const formOn = lt >= 1.95 && lt < 4.0;
  const form = formOn ? Math.min(appear(lt, 1.95, 0.3), 1 - appear(lt, 3.75, 0.25)) : 0;
  const name = typed('Alex', lt, 2.45, 0.12);
  const inserted = lt >= 3.95;
  const done = appear(lt, 3.95, 0.5);
  const caret = Math.floor(lt * 2) % 2 === 0;

  return (
    <Scene zoom={0.015}>
      <StepTag n={2} label="Type a shortcut anywhere" lt={lt} />
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          background: '#fff',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(0,0,0,.14), 0 6px 20px rgba(0,0,0,.07)',
          border: `1px solid ${LINE}`,
        }}
      >
        <div style={{ height: 52, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 22px', background: SOFT, fontFamily: FONT, fontSize: 14.5, fontWeight: 700, color: INK }}>
          New message
        </div>
        {[
          ['To', 'Alex'],
          ['Subject', 'Project update'],
        ].map(([k, v]) => (
          <div key={k} style={{ height: 44, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', fontFamily: FONT, fontSize: 14 }}>
            <span style={{ color: INK_SUB, width: 56 }}>{k}</span>
            <span style={{ color: INK }}>{v}</span>
          </div>
        ))}
        <div style={{ padding: '22px 22px', minHeight: 240, fontFamily: FONT, fontSize: 17, color: INK, lineHeight: 1.65, position: 'relative' }}>
          {!inserted ? (
            <div>
              <span style={{ fontFamily: MONO, fontSize: 16.5, fontWeight: 700, color: AZURE }}>{shortcut}</span>
              <span style={{ display: 'inline-block', width: 2, height: 20, background: INK, marginLeft: 1, verticalAlign: '-4px', opacity: caret ? 1 : 0 }} />
            </div>
          ) : (
            <div style={{ opacity: done, transform: `translateY(${lerp(8, 0, done)}px)` }}>
              <div>
                Hi <b style={{ background: AZURE_BG, borderRadius: 4, padding: '0 3px' }}>Alex</b>,
              </div>
              <div style={{ height: 12 }} />
              <div>The first draft is ready for your review.</div>
              <div>Let me know what you think.</div>
              <div style={{ height: 12 }} />
              <div>Best regards</div>
            </div>
          )}
        </div>
        <div style={{ borderTop: `1px solid ${LINE}`, padding: '12px 22px', display: 'flex', alignItems: 'center', background: SOFT }}>
          <div style={{ height: 38, padding: '0 22px', borderRadius: 10, background: AZURE, color: '#fff', display: 'flex', alignItems: 'center', fontFamily: FONT, fontSize: 14, fontWeight: 600 }}>Send</div>
        </div>
      </div>

      {/* the Insert snippet menu, at the cursor */}
      <FloatingMenu title="Insert snippet" show={menu} left={x + 22} top={y + 196}>
        <MenuRow icon={<SnippetIcon className="h-4 w-4" />} name="Follow-up" detail="::followup" active />
        <MenuRow icon={<SnippetIcon className="h-4 w-4" />} name="Meeting recap" detail="::recap" active={false} />
        <MenuRow icon={<SnippetIcon className="h-4 w-4" />} name="Thank you" detail="::thanks" active={false} />
      </FloatingMenu>

      {/* the fill form */}
      {form > 0.001 && (
        <div
          style={{
            position: 'absolute',
            left: 300,
            top: 150,
            width: 680,
            background: '#fff',
            borderRadius: 16,
            border: `1px solid ${LINE}`,
            boxShadow: '0 30px 80px rgba(16,28,57,.28)',
            opacity: form,
            transform: `scale(${lerp(0.97, 1, form)})`,
            zIndex: 25,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 22px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <SnippetIcon className="h-4 w-4" />
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: INK }}>Follow-up</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 22, padding: 22 }}>
            <div>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: INK_MUT, marginBottom: 6 }}>Name</div>
              <div style={{ height: 42, borderRadius: 10, border: `2px solid ${AZURE}`, display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: INK }}>
                {name}
                <span style={{ display: 'inline-block', width: 2, height: 18, background: INK, marginLeft: 1, opacity: Math.floor(lt * 3) % 2 ? 1 : 0 }} />
              </div>
            </div>
            <div>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: INK_MUT, marginBottom: 6 }}>Message preview</div>
              <div style={{ borderRadius: 10, background: SOFT, border: `1px solid ${LINE}`, padding: '10px 12px', fontFamily: FONT, fontSize: 13.5, color: INK, lineHeight: 1.55 }}>
                Hi {name ? <b>{name}</b> : <span style={{ color: INK_SUB }}>Name</span>},
                <br />
                The first draft is ready for your review.
              </div>
            </div>
          </div>
          <div style={{ padding: '12px 22px', borderTop: `1px solid ${LINE}`, display: 'flex', justifyContent: 'flex-end', background: SOFT }}>
            <div
              style={{
                height: 38,
                padding: '0 20px',
                borderRadius: 10,
                background: AZURE,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                transform: `scale(${lt >= 3.5 && lt < 3.65 ? 0.95 : 1})`,
              }}
            >
              Insert message
            </div>
          </div>
        </div>
      )}
      <Caption text="Type a shortcut. Get the whole message." at={4.5} lt={lt} />
    </Scene>
  );
}

/* ================================================================ */
/* SCENE 3: a prompt from the """ menu, with a Brain                 */
/* ================================================================ */
const PROMPT_TEXT = 'You are my project assistant. Turn my notes into a clear project brief. Keep it concise. End with next steps.';
const BRAIN_ITEMS = ['Project brief', 'Launch plan', 'Decisions so far'];

function ScenePrompt(): ReactElement {
  const { localTime: lt } = useSprite();
  const x = 250;
  const y = 70;
  const w = 780;

  const quotes = typed('"""', lt, 0.5, 0.14);
  const menu = lt >= 1.0 && lt < 2.35 ? appear(lt, 1.0, 0.25) : 0;
  const active = lt >= 1.6 ? 0 : 1;
  const inserted = lt >= 2.35;
  const words = inserted ? typed(PROMPT_TEXT, lt, 2.4, 0.012) : '';
  const brain = appear(lt, 3.3, 0.4);
  const caret = Math.floor(lt * 2) % 2 === 0;

  return (
    <Scene zoom={0.015}>
      <StepTag n={3} label="Bring your prompts and Brains to any AI" lt={lt} />
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: 520,
          background: '#fff',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 40px 90px rgba(0,0,0,.14), 0 6px 20px rgba(0,0,0,.07)',
          border: `1px solid ${LINE}`,
        }}
      >
        <div style={{ height: 52, borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 22px', background: SOFT }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={INK_MUT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />
          </svg>
          <span style={{ fontFamily: FONT, fontSize: 14.5, fontWeight: 700, color: INK }}>Your AI chat</span>
        </div>
        <div style={{ padding: '26px 26px 0', fontFamily: FONT, fontSize: 15, color: INK_SUB }}>How can I help you today?</div>

        {/* the message box, at the bottom */}
        <div
          style={{
            position: 'absolute',
            left: 22,
            right: 22,
            bottom: 22,
            minHeight: 120,
            borderRadius: 16,
            border: `1px solid ${LINE}`,
            padding: '16px 18px 56px',
            fontFamily: FONT,
            fontSize: 15.5,
            color: INK,
            lineHeight: 1.6,
            boxShadow: '0 4px 14px rgba(0,0,0,.05)',
          }}
        >
          {!inserted ? (
            <span>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: AZURE }}>{quotes}</span>
              <span style={{ display: 'inline-block', width: 2, height: 18, background: INK, marginLeft: 1, verticalAlign: '-3px', opacity: caret ? 1 : 0 }} />
            </span>
          ) : (
            <div>
              <div>{words}</div>
              {brain > 0.001 && (
                <div style={{ marginTop: 12, opacity: brain, transform: `translateY(${lerp(6, 0, brain)}px)` }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: INK_MUT, marginBottom: 8 }}>
                    Base your answer on my Brain “Project Atlas”:
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {BRAIN_ITEMS.map((item, i) => {
                      const e = appear(lt, 3.45 + i * 0.18, 0.3);
                      return (
                        <span
                          key={item}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '5px 10px',
                            borderRadius: 999,
                            background: AZURE_BG,
                            color: AZURE,
                            fontSize: 13,
                            fontWeight: 600,
                            opacity: e,
                            transform: `scale(${lerp(0.9, 1, e)})`,
                          }}
                        >
                          <BrainIcon className="h-3.5 w-3.5" />
                          {item}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ position: 'absolute', right: 14, bottom: 12, width: 34, height: 34, borderRadius: '50%', background: inserted ? INK : LINE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </div>
        </div>
      </div>

      {/* the Prompt mode menu, opening upward from the box */}
      <FloatingMenu title="Prompt mode" show={menu} left={x + 22} top={y + 196} width={400}>
        <MenuRow icon={<PromptIcon className="h-4 w-4" />} name="Project brief" detail="+ Brain" active={active === 0} />
        <MenuRow icon={<PromptIcon className="h-4 w-4" />} name="Rewrite in my voice" detail="voice" active={active === 1} />
        <MenuRow icon={<PromptIcon className="h-4 w-4" />} name="Summarize my notes" detail="notes" active={false} />
      </FloatingMenu>
      <Caption text="Your best prompts. Your own knowledge." at={4.6} lt={lt} />
    </Scene>
  );
}

/* ================================================================ */
/* SCENE 4: the same library on the phone                            */
/* ================================================================ */
function PhoneShell({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        width: 300,
        height: 610,
        borderRadius: 46,
        background: '#0D0D0F',
        padding: 10,
        boxShadow: '0 40px 80px rgba(0,0,0,.28), 0 8px 20px rgba(0,0,0,.14)',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', height: '100%', borderRadius: 37, overflow: 'hidden', background: '#F2F2F7', position: 'relative' }}>{children}</div>
    </div>
  );
}

function PhoneHome(): ReactElement {
  const tasks: Array<[ReactNode, string, string]> = [
    [<SnippetIcon key="s" className="h-4 w-4" />, 'Use a snippet', 'Find, personalize, and copy'],
    [<PromptIcon key="p" className="h-4 w-4" />, 'Prepare a prompt', 'Pick one and copy it'],
    [<BrainIcon key="b" className="h-4 w-4" />, 'Capture a note', 'Save text into a Brain'],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ background: NAVY, padding: '46px 18px 22px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TMark size={20} color="#fff" />
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700 }}>Fibonax</span>
        </div>
        <div style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, marginTop: 18, letterSpacing: '-.5px' }}>What&apos;s next?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {tasks.map(([icon, title, sub]) => (
            <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: NAVY_SOFT, border: '1px solid #6B7C9C55' }}>
              <span style={{ color: '#fff', display: 'flex' }}>{icon}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 700 }}>{title}</span>
                <span style={{ fontFamily: FONT, fontSize: 11, color: NAVY_COPY }}>{sub}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '16px 14px' }}>
        <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: INK_MUT, marginBottom: 8 }}>Ready to reuse</div>
        <div style={{ background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, padding: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: INK }}>Follow-up</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: INK_SUB, marginTop: 3 }}>Used 128 times</div>
        </div>
      </div>
    </div>
  );
}

function PhoneSnippets({ copied }: { copied: number }): ReactElement {
  const cards: Array<[string, string]> = [
    ['Follow-up', 'Hi Alex, the first draft is ready for your review.'],
    ['Meeting recap', 'Here is a short recap of today.'],
    ['Thank you', 'Thank you, Alex. I really appreciate it.'],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ background: NAVY, padding: '46px 16px 16px', color: '#fff' }}>
        <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 700, letterSpacing: '-.4px' }}>
          Snippets <span style={{ fontSize: 13, color: NAVY_COPY, fontWeight: 600 }}>12</span>
        </div>
        <div style={{ marginTop: 12, height: 36, borderRadius: 12, background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.24)', display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: FONT, fontSize: 13, color: NAVY_COPY }}>
          Search snippets
        </div>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cards.map(([title, text], i) => (
          <div key={title} style={{ background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, padding: 14 }}>
            <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
            <div style={{ fontFamily: FONT, fontSize: 12, color: INK_MUT, marginTop: 4, lineHeight: 1.4 }}>{text}</div>
            {i === 0 && (
              <div style={{ marginTop: 10, height: 32, borderRadius: 10, background: copied > 0 ? AZURE_BG : AZURE, color: copied > 0 ? AZURE : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontSize: 12.5, fontWeight: 700 }}>
                {copied > 0 ? '✓ Copied' : 'Fill & copy'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScenePhone(): ReactElement {
  const { localTime: lt } = useSprite();
  const px = 170;
  const py = 56;
  const enter = appear(lt, 0, 0.5);
  const list = appear(lt, 1.6, 0.35);
  const copied = lt >= 3.0 ? 1 : 0;
  const text = appear(lt, 0.4, 0.5);

  return (
    <Scene zoom={0.015}>
      <StepTag n={4} label="Take it with you" lt={lt} />
      <div style={{ position: 'absolute', left: px, top: py, opacity: enter, transform: `translateY(${lerp(24, 0, enter)}px)` }}>
        <PhoneShell>
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - list }}>
            <PhoneHome />
          </div>
          {list > 0.001 && (
            <div style={{ position: 'absolute', inset: 0, opacity: list }}>
              <PhoneSnippets copied={copied} />
            </div>
          )}
        </PhoneShell>
        {/* taps: Use a snippet, then Fill & copy */}
        <TapPulse x={150} y={165} t={lt - 1.3} />
        <TapPulse x={150} y={256} t={lt - 2.8} />
      </div>

      <div style={{ position: 'absolute', left: 560, top: 190, width: 600, opacity: text, transform: `translateX(${lerp(26, 0, text)}px)` }}>
        <div style={{ fontFamily: FONT, fontSize: 52, fontWeight: 700, color: INK, letterSpacing: '-1.6px', lineHeight: 1.05 }}>On your phone too</div>
        <div style={{ fontFamily: FONT, fontSize: 20, color: INK_MUT, marginTop: 22, lineHeight: 1.55, maxWidth: 520 }}>
          Open <b style={{ color: INK }}>app.fibonax.com/mobile</b> and sign in. Your snippets, prompts and Brains are there, ready to fill and copy.
        </div>
      </div>
    </Scene>
  );
}

/* ================================================================ */
/* OUTRO: the T                                                      */
/* ================================================================ */
function Outro(): ReactElement {
  const { localTime: lt } = useSprite();
  const lp = clamp(lt / 0.7, 0, 1);
  const wp = appear(lt, 0.35, 0.6);
  const uw = appear(lt, 0.8, 0.7);
  const tp = appear(lt, 0.7, 0.6);
  return (
    <Scene zoom={0.02} bg="#FFFFFF">
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <div style={{ transform: `scale(${back(lp)})`, opacity: clamp(lp * 1.5, 0, 1) }}>
          <AppIcon size={112} radius={28} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: wp, transform: `translateY(${lerp(14, 0, wp)}px)` }}>
          <div style={{ fontFamily: FONT, fontSize: 58, fontWeight: 700, color: INK, letterSpacing: '-1.6px' }}>Fibonax</div>
          <div style={{ height: 4, background: AZURE, borderRadius: 2, marginTop: 12, width: lerp(0, 300, uw) }} />
        </div>
        <div style={{ fontFamily: FONT, fontSize: 22, color: INK_MUT, opacity: tp, letterSpacing: '-.2px' }}>
          Snippets, prompts and Brains for every team.
        </div>
      </div>
    </Scene>
  );
}

/* ================================================================ */
export function OnboardingAnimation(): ReactElement {
  return (
    <AnimationStage duration={30} background={DESK}>
      <Sprite start={0} end={6.6}>
        <SceneInstall />
      </Sprite>
      <Sprite start={6.6} end={12.9}>
        <SceneSnippet />
      </Sprite>
      <Sprite start={12.9} end={19.6}>
        <ScenePrompt />
      </Sprite>
      <Sprite start={19.6} end={25.4}>
        <ScenePhone />
      </Sprite>
      <Sprite start={25.4} end={30}>
        <Outro />
      </Sprite>
    </AnimationStage>
  );
}
