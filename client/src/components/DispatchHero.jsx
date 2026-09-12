import { memo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, ArrowUpRight, MoveUpRight, Music2, ScanLine } from 'lucide-react';
import Magnet from './react-bits/Magnet.jsx';
import ScrollVelocity from './react-bits/ScrollVelocity.jsx';

function DispatchHero({ motionEnabled }) {
  const stage = useRef(null);
  return (
    <>
      <section className="dispatch-hero" aria-labelledby="dispatch-title">
        <div className="hero-kicker">
          <span className="live-dot" /> FILES MOVE. GOOD THINGS HAPPEN. <span>EST. 2026</span>
        </div>
        <div className="hero-composition">
          <div className="hero-message">
            <h1 id="dispatch-title">
              SEND
              <br />
              <span>IT.</span>
              <ArrowUpRight aria-hidden="true" />
            </h1>
            <div className="hero-caption">
              <p>
                That photo. That playlist.
                <br />
                That very final final file.
                <br />
                <strong>From your device to theirs.</strong>
              </p>
              <Magnet padding={30} magnetStrength={6} disabled={!motionEnabled}>
                <a className="drop-jump" href="#transfer" aria-label="Start a file transfer">
                  <ArrowDown size={28} />
                  <span>
                    MAKE
                    <br />
                    THE DROP
                  </span>
                </a>
              </Magnet>
            </div>
          </div>
          <div className="dispatch-stage" ref={stage} aria-hidden="true">
            <div className="orbit-track track-one" />
            <div className="orbit-track track-two" />
            <div className="stage-cross cross-one">+</div>
            <div className="stage-cross cross-two">+</div>
            <motion.div
              className="dispatch-object"
              drag={motionEnabled}
              dragConstraints={stage}
              dragElastic={0.12}
              dragSnapToOrigin
              whileDrag={{ scale: 1.04, rotate: 0 }}
              initial={{ y: 30, rotate: -10, opacity: 0 }}
              animate={{ y: 0, rotate: -8, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 100, damping: 17 }}
            >
              <div className="paper paper-back">
                <span>THE GOOD STUFF</span>
                <Music2 size={68} strokeWidth={1} />
                <b>PLAY IT LOUD.</b>
                <small>AUDIO / 003</small>
              </div>
              <div className="paper paper-photo">
                <span>MEMORY CARD</span>
                <div className="photo-art">
                  <i />
                  <b />
                  <em />
                </div>
                <small>WISH YOU WERE HERE ↗</small>
              </div>
              <div className="folder-back" />
              <div className="folder-front">
                <span className="folder-index">
                  QD—001 <MoveUpRight size={18} />
                </span>
                <strong>
                  GOOD
                  <br />
                  STUFF
                  <br />
                  INSIDE.
                </strong>
                <div className="folder-bottom">
                  <span>
                    HANDLE WITH
                    <br />
                    ABSOLUTELY NO FUSS.
                  </span>
                  <span className="barcode" />
                </div>
              </div>
              <div className="dispatch-sticker">
                <ScanLine size={22} />
                <span>
                  SCAN.
                  <br />
                  ACCEPT.
                  <br />
                  YOURS.
                </span>
              </div>
            </motion.div>
            <div className="orbit-stamp">
              DIRECT
              <br />
              <span>DELIVERY</span>
              <ArrowUpRight size={22} />
            </div>
            <span className="stage-note">NO DETOURS. NO SIGN-UPS.</span>
            <span className="drag-note">
              {motionEnabled
                ? 'A LITTLE PLAY BEFORE THE SEND. ↗'
                : 'YOUR NEXT DEVICE IS ONE SCAN AWAY.'}
            </span>
          </div>
        </div>
        <div className="hero-baseline">
          <span>A SMALL TOOL FOR BIG SHARES.</span>
          <span>ONE FILE. TWO DEVICES. ZERO DRAMA.</span>
          <span>SCROLL TO SEND ↓</span>
        </div>
      </section>
      <div className="dispatch-ticker" aria-hidden="true">
        <ScrollVelocity
          texts={['LESS WAITING. ↗ MORE SHARING. ↗']}
          velocity={35}
          paused={!motionEnabled}
          numCopies={4}
        />
      </div>
    </>
  );
}

export default memo(DispatchHero);
