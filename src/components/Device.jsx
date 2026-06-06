import LcdDisplay from './LcdDisplay.jsx'
import Knob from './Knob.jsx'
import '../styles/device.css'

// Per-variant geometry, as percentages of the (square) photo. Tuned to the two
// product photos in /public. Each region is {left, top, width, height}.
export const VARIANTS = {
  flat: {
    label: 'Flat panel',
    img: 'aerocruze100-flata.webp', // chrome with a transparent display cut-out
    // slightly larger than the transparent cut-out so the bezel masks the edges
    glass: { left: 11.5, top: 42, width: 44.5, height: 16 },
    mode: { left: 83.5, top: 41, width: 11, height: 8 },
    alt: { left: 83.5, top: 52, width: 11, height: 8 },
    knob: { left: 64.5, top: 43.5, width: 12, height: 12 },
  },
  round: {
    label: '2-inch round',
    img: 'aerocruze100-2incha.webp',
    // slightly larger than the transparent cut-out so the bezel masks the edges
    glass: { left: 13, top: 33, width: 73.5, height: 26 },
    mode: { left: 16, top: 65, width: 21, height: 14 },
    alt: { left: 63, top: 65, width: 21, height: 14 },
    knob: { left: 42, top: 68, width: 16, height: 16 },
  },
}

const box = (r) => ({ left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` })

export default function Device({ variant, state, actions }) {
  const v = VARIANTS[variant]
  return (
    <div className="device">
      {/* simulated LCD sits underneath... */}
      <div className="glass-wrap" style={box(v.glass)}>
        <LcdDisplay state={state} />
      </div>

      {/* ...and the photo's chrome (with a transparent display cut-out) on top */}
      <img className="device-chrome" src={`${import.meta.env.BASE_URL}${v.img}`} alt="" draggable="false" />

      <button
        className="hit btn-hit"
        style={box(v.mode)}
        onClick={actions.mode}
        aria-label="MODE button"
        title="MODE"
      />
      <button
        className="hit btn-hit"
        style={box(v.alt)}
        onClick={actions.alt}
        aria-label="ALT button"
        title="ALT"
      />

      <div className="hit knob-wrap" style={box(v.knob)}>
        <Knob
          onRotate={actions.rotate}
          onPress={actions.knobPress}
          onHold={actions.knobHold}
        />
      </div>
    </div>
  )
}
