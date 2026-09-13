import { memo } from 'react';
import { ArrowDown, ArrowUpRight, LockKeyhole, Zap, Globe2 } from 'lucide-react';
import Magnet from './react-bits/Magnet.jsx';
import GlassSculpture from './GlassSculpture.jsx';

function DispatchHero({ motionEnabled }) {
  return (
    <section className="dispatch-hero" aria-labelledby="dispatch-title">
      <div className="hero-composition">
        <div className="hero-message">
          <div className="hero-kicker">
            <span /> A little closer. A lot simpler.
          </div>
          <h1 id="dispatch-title">
            From here.
            <br />
            <em>To there.</em>
          </h1>
          <p className="hero-description">
            Your files, effortlessly in motion.
            <br />A private connection between your devices.
            <br />
            No uploads. No accounts. Just a quick drop.
          </p>
          <div className="hero-actions">
            <Magnet padding={35} magnetStrength={8} disabled={!motionEnabled}>
              <a className="drop-jump" href="#transfer" aria-label="Start a file transfer">
                Make a drop <ArrowUpRight size={19} />
              </a>
            </Magnet>
            <span>Free. As it should be.</span>
          </div>
        </div>
        <div className="dispatch-stage" aria-hidden="true">
          <div className="sculpture-halo" />
          <GlassSculpture motionEnabled={motionEnabled} />
          <div className="glass-label label-from">
            <span className="device-dot" />
            <div>
              <small>FROM</small>
              <span>Your device</span>
            </div>
            <ArrowUpRight size={17} />
          </div>
          <div className="glass-label label-to">
            <div className="arrival-icon">
              <ArrowDown size={19} />
            </div>
            <div>
              <small>TO</small>
              <span>Somewhere new</span>
            </div>
          </div>
          <span className="sculpture-caption">A direct connection. An effortless exchange.</span>
        </div>
      </div>
      <div className="hero-baseline">
        <span>
          <LockKeyhole size={15} /> Encrypted in transit
        </span>
        <span>
          <Zap size={15} /> Straight between devices
        </span>
        <span>
          <Globe2 size={15} /> Made for your browser
        </span>
        <a href="#transfer" aria-label="Scroll to transfer">
          <ArrowDown size={17} />
        </a>
      </div>
    </section>
  );
}
export default memo(DispatchHero);
