import * as THREE from 'three';
import { AudioEngine } from '../audio/engine';
import { Transport, type StepEvent } from '../audio/transport';
import * as V from '../audio/voices';
import { clamp, damp, formatInt } from '../core/math';
import { Input } from '../core/input';
import { prof } from '../core/prof';
import { dailyKey, dailySeed, parseSeedCode, seedToCode } from '../core/rng';
import { loadSave, writeSave, type SaveData, type Settings } from '../core/save';
import { BeamFx, GroundFx, GroundKind, ParticleSystem, Shape } from '../render/fx';
import { CameraRig } from '../render/cameraRig';
import { IconFactory } from '../render/icons';
import { makeClubEnvironment } from '../render/materials';
import { NeonSign } from '../render/neonSign';
import { DamageNumbers } from '../render/numbers';
import { PlayerModel } from '../render/playerModel';
import { QUALITY, Stage } from '../render/stage';
import { clampToBounds, pushOutOfObstacles, type Venue } from '../render/venues/venue';
import { Basement } from '../render/venues/basement';
import { Cathedral } from '../render/venues/cathedral';
import { Mainstage } from '../render/venues/mainstage';
import { cardRarity, drawGoldOffers, drawOffers, PEDALS, type Card, type DraftContext } from '../seq/cards';
import { GROOVES, type GrooveId } from '../seq/grooves';
import { INSTRUMENTS, type InstrumentId } from '../seq/instruments';
import { SETLISTS, SETLIST_IDS, type SetlistId } from '../seq/setlists';
import { BackstageScreen, type ShopItem } from '../ui/backstage';
import { describeCard } from '../ui/cardInfo';
import { h } from '../ui/dom';
import { downloadBlob, renderPoster } from '../ui/poster';
import { DraftScreen } from '../ui/draft';
import { Hud } from '../ui/hud';
import {
  HowToScreen,
  MerchScreen,
  PauseScreen,
  ResultsScreen,
  SettingsScreen,
  TitleScreen,
  UNLOCK_COST,
} from '../ui/screens';
import { SeqEditor } from '../ui/seqEditor';
import { Band } from './band';
import { Boss, Cantor, Feedback, TheHush, type BossCtx } from './bosses';
import { Director } from './director';
import { DAMPER_RADIUS, EnemyManager, type Enemy } from './enemies';
import { Music, type NoteEvent } from './music';
import { PickupManager, type Pickup } from './pickups';
import { ProjectileManager, type Projectile } from './projectiles';
import { Run, type RunMode } from './run';
import { fireTrack, type HitOpts, type WeaponCtx } from './weapons';

type State = 'boot' | 'title' | 'playing' | 'draft' | 'paused' | 'backstage' | 'results' | 'dying' | 'outro';

interface Player {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  tilt: number;
  dashT: number;
  dashX: number;
  dashZ: number;
  charges: number;
  maxCharges: number;
  rechargeT: number;
  invuln: number;
  radius: number;
  aimX: number;
  aimZ: number;
}

const VENUE_NAMES = ['THE BASEMENT', 'THE CATHEDRAL', 'THE MAINSTAGE'];

export class Game {
  private readonly stage: Stage;
  private readonly rig: CameraRig;
  private readonly audio: AudioEngine;
  private readonly transport: Transport;
  private readonly music: Music;
  private readonly input: Input;
  private save: SaveData;
  private readonly icons: IconFactory;
  private readonly env: THREE.Texture;

  private venue: Venue;
  private readonly world = new THREE.Group();
  private readonly enemies: EnemyManager;
  private readonly projectiles = new ProjectileManager();
  private readonly pickups = new PickupManager();
  private readonly glow = new ParticleSystem(7000, THREE.AdditiveBlending, 1.7);
  private readonly dark = new ParticleSystem(2600, THREE.NormalBlending, 1);
  private readonly ground = new GroundFx(900);
  private readonly shadowFx = new GroundFx(200, true);
  private readonly beams = new BeamFx(900);
  private readonly numbers: DamageNumbers;
  private readonly band = new Band();
  private readonly playerModel = new PlayerModel();
  private readonly sign = new NeonSign();

  private readonly hud: Hud;
  private readonly draftUi: DraftScreen;
  private readonly title: TitleScreen;
  private readonly pauseUi: PauseScreen;
  private readonly settingsUi: SettingsScreen;
  private readonly howto: HowToScreen;
  private readonly results: ResultsScreen;
  private readonly merch: MerchScreen;
  private readonly backstage: BackstageScreen;
  private readonly flash: HTMLElement;
  private editor: SeqEditor | null = null;

  private state: State = 'boot';
  private prevState: State = 'title';
  private run: Run | null = null;
  private director: Director | null = null;
  private boss: Boss | null = null;
  private bossDownT = 0;
  private readonly player: Player = {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    facing: 0,
    tilt: 0,
    dashT: 0,
    dashX: 0,
    dashZ: 0,
    charges: 2,
    maxCharges: 2,
    rechargeT: 0,
    invuln: 0,
    radius: 0.75,
    aimX: 0,
    aimZ: -1,
  };

  private time = 0;
  private last = performance.now();
  private hitStop = 0;
  private slowMo = 0;
  private streak = 0;
  private streakT = 0;
  private pickupChain = 0;
  private pickupChainT = 0;
  private dropState: 'idle' | 'ready' | 'queued' | 'active' = 'idle';
  private buildStart = 0;
  private buildEnd = 0;
  private buildT = 0;
  private readonly spectrum = new Float32Array(16);
  private readonly scheduled: { t: number; fn: () => void }[] = [];
  private currentStep = 0;
  private muffleTarget = 0;
  private muffleHurt = 0;
  private silenced = false;
  private muted = false;
  private draftPending: { gold: boolean; offers: Card[]; pickedIndex: number; placing: 'notes' | 'fx' | null } | null =
    null;
  private shop: { items: (ShopItem & { card: Card })[]; rerollPrice: number; healPrice: number } | null = null;
  private announceQueue: { title: string; sub: string; color: string; big: boolean }[] = [];
  private announceCooldown = 0;
  private dyingT = 0;
  private titleCam = 0;
  private readonly tmp = { x: 0, z: 0 };
  private readonly aimV = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly scr = { x: 0, y: 0 };
  private readonly weaponCtx: WeaponCtx;
  private readonly bossCtx: BossCtx;
  private energy = 0;
  private newGroovesThisRun = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.save = loadSave();
    this.stage = new Stage(canvas, QUALITY[this.save.settings.quality]);
    this.rig = new CameraRig(this.stage.camera);
    this.audio = new AudioEngine();
    // bake drum hits in the background; until ready, voices synthesise live
    void V.bakeDrumSamples(this.audio).catch(() => undefined);
    this.transport = new Transport(96);
    this.music = new Music(this.audio, this.transport);
    this.input = new Input(canvas);
    this.env = makeClubEnvironment(this.stage.renderer, [0xff2d55, 0xff8a1f, 0x3dd9ff, 0xb04dff, 0xffffff]);
    this.stage.scene.environment = this.env;
    this.stage.scene.environmentIntensity = 0.7;
    this.icons = new IconFactory(this.stage.renderer, this.env);
    this.numbers = new DamageNumbers();

    this.venue = new Basement();
    this.enemies = new EnemyManager(this.venue.palette.rim, this.venue.palette.floor);
    this.applyVenueLook();
    this.stage.scene.add(this.world);
    this.world.add(
      this.venue.group,
      this.enemies.group,
      this.projectiles.group,
      this.pickups.group,
      this.shadowFx.mesh,
      this.ground.mesh,
      this.glow.mesh,
      this.dark.mesh,
      this.beams.mesh,
      this.numbers.mesh,
      this.band.group,
      this.playerModel.root,
      this.playerModel.cableMesh,
    );
    this.sign.group.position.set(0, 12.4, -27.7);
    this.sign.group.scale.setScalar(2.3);
    this.world.add(this.sign.group);

    // UI
    this.flash = h('div', { class: 'screen-flash' });
    uiRoot.append(this.flash);
    this.hud = new Hud(uiRoot);
    this.draftUi = new DraftScreen(uiRoot);
    this.title = new TitleScreen(uiRoot, {
      play: () => this.startRun('standard'),
      daily: () => this.startRun('daily'),
      merch: () => this.openMerch(),
      howto: () => this.howto.setVisible(true),
      settings: () => this.settingsUi.open(this.save.settings),
      cycleSetlist: (dir) => this.cycleSetlist(dir),
    });
    this.pauseUi = new PauseScreen(uiRoot, {
      resume: () => this.resume(),
      settings: () => this.settingsUi.open(this.save.settings),
      howto: () => this.howto.setVisible(true),
      quit: () => this.endRun(false, true),
    });
    this.settingsUi = new SettingsScreen(uiRoot, {
      change: (s) => this.applySettings(s),
      close: () => this.settingsUi.close(),
    });
    this.howto = new HowToScreen(uiRoot, () => this.howto.setVisible(false), this.icons);
    this.results = new ResultsScreen(uiRoot, {
      again: () => this.onResultsPrimary(),
      menu: () => this.toTitle(),
      merch: () => this.openMerch(),
      poster: () => this.savePoster(),
    });
    this.merch = new MerchScreen(uiRoot, this.icons, {
      buy: (id) => this.buyUnlock(id),
      loudness: (n) => {
        this.save.loudness = n;
        writeSave(this.save);
        this.merch.open(this.save);
        V.uiClick(this.audio, this.audio.now, 5);
      },
      close: () => this.merch.close(),
    });
    this.backstage = new BackstageScreen(uiRoot, {
      buy: (i) => this.shopBuy(i),
      heal: () => this.shopHeal(),
      reroll: () => this.shopReroll(),
      next: () => this.leaveBackstage(),
    });

    this.weaponCtx = this.makeWeaponCtx();
    this.bossCtx = this.makeBossCtx();
    this.applySettings(this.save.settings, false);

    // UI sounds on every button
    uiRoot.addEventListener('pointerover', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button:not([disabled])')) V.uiHover(this.audio, this.audio.now, Math.random() * 3);
    });
    uiRoot.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button:not([disabled])')) V.uiClick(this.audio, this.audio.now);
    });
    const unlock = (): void => {
      void this.audio.resume();
      if (this.state === 'title' && !this.title.revealed) {
        this.title.reveal();
        this.sign.ignite();
        V.impact(this.audio, this.audio.now + 0.02, 0.5);
        this.buzz();
        if (!this.transport.running) this.transport.start(this.audio.now + 0.1);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else if (this.title.revealed) {
        void this.audio.resume();
      }
    });
    setInterval(() => this.transport.pump(this.audio.now), 25);
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.state === 'playing') this.pause();
      this.hud.toast('GRAPHICS CONTEXT LOST — RELOAD THE PAGE', '#ff3b5c');
    });
    // a shared run: ?seed=CODE (strictly validated; anything else is ignored)
    try {
      this.sharedSeed = parseSeedCode(new URLSearchParams(window.location.search).get('seed'));
    } catch {
      this.sharedSeed = null;
    }
  }

  private sharedSeed: number | null = null;
  private perfT = 0;
  private perfFrames = 0;
  private perfSlow = 0;

  /** Step graphics quality down automatically if the machine can't hold ~45fps. */
  private watchPerformance(rawDt: number): void {
    if (this.state !== 'playing') return;
    this.perfT += rawDt;
    this.perfFrames++;
    if (this.perfT < 3) return;
    const fps = this.perfFrames / this.perfT;
    this.perfT = 0;
    this.perfFrames = 0;
    this.perfSlow = fps < 45 ? this.perfSlow + 1 : 0;
    if (this.perfSlow >= 2) {
      this.perfSlow = 0;
      const q = this.save.settings.quality;
      const next = q === 'high' ? 'medium' : q === 'medium' ? 'low' : null;
      if (next) {
        this.applySettings({ ...this.save.settings, quality: next });
        this.hud.toast(`GRAPHICS → ${next.toUpperCase()} FOR SMOOTHER PLAY`, '#2ee6ff');
      }
    }
  }

  /* ───────────────────────────── boot / title ───────────────────────────── */

  start(): void {
    this.icons.warm();
    this.toTitle();
    this.loop();
    if (import.meta.env.DEV) this.exposeDebug();
  }

  private toTitle(): void {
    this.results.setVisible(false);
    this.pauseUi.setVisible(false);
    this.backstage.close();
    this.draftUi.close();
    this.hud.setVisible(false);
    this.clearWorld();
    this.setVenue(0);
    this.run = null;
    this.boss = null;
    this.state = 'title';
    this.title.update(this.save, dailyKey(new Date()), this.sharedSeed !== null ? seedToCode(this.sharedSeed) : null);
    this.title.setVisible(true);
    this.music.pattern = null;
    this.music.backing = 'menu';
    this.music.dropUntil = -1;
    this.music.dropAtBar = -1;
    this.music.hushed = false;
    this.transport.setBpm(92);
    this.audio.setTempo(92);
    this.stage.hueSat.hue = 0;
    this.muffleTarget = 0;
    this.band.sync([]);
    this.player.x = 0;
    this.player.z = -22.4;
    this.playerModel.resetCable(0, -22.4);
    this.sign.group.visible = true;
  }

  private buzz(): void {
    const t = this.audio.now;
    for (let i = 0; i < 6; i++) V.zap(this.audio, t + i * 0.16 + Math.random() * 0.05, 0.6);
  }

  /* ───────────────────────────── run lifecycle ───────────────────────────── */

  private startRun(mode: RunMode, seedOverride?: number): void {
    void this.audio.resume();
    const shared = mode === 'standard' && seedOverride === undefined ? this.sharedSeed : null;
    const seed =
      seedOverride ?? shared ?? (mode === 'daily' ? dailySeed(new Date()) : (Math.random() * 2 ** 32) >>> 0);
    const sl = SETLISTS[this.save.setlist as SetlistId];
    const setlist: SetlistId = mode === 'daily' || !sl || !sl.unlocked(this.save) ? 'garage' : sl.id;
    this.run = new Run(seed, mode, this.save.loudness, setlist);
    this.newGroovesThisRun = 0;
    this.title.setVisible(false);
    this.results.setVisible(false);
    this.merch.close();
    this.sign.group.visible = false;
    this.save.runs++;
    writeSave(this.save);
    this.beginVenue(0);
    if (!this.save.seenTutorial) {
      this.save.seenTutorial = true;
      writeSave(this.save);
      this.schedule(3.2, () => this.hud.toast('WASD move · MOUSE aim · SPACE dash on the beat', '#fff'));
      this.schedule(7, () => this.hud.toast('Your instruments fire on their own — every lit step', '#ffe14d'));
    }
  }

  private beginVenue(index: number): void {
    const run = this.run!;
    run.venueIndex = index;
    run.setTime = 0;
    this.clearWorld();
    this.setVenue(index);
    this.director = new Director(index, run.loop, run.spawnRng);
    this.boss = null;
    this.bossDownT = 0;
    this.player.x = 0;
    this.player.z = 4;
    this.player.vx = this.player.vz = 0;
    this.playerModel.baseY = 0;
    this.playerModel.showFloorFx = true;
    this.player.invuln = 2;
    this.playerModel.resetCable(0, 4);
    this.rig.target.set(0, 0, 4);
    this.rig.snap();
    // opening swoop: start high and wide, settle onto the frontman
    this.rig.distance = 78;
    this.rig.update(0.016);
    // encore loops play "after hours": the whole room shifts hue each time round
    this.stage.hueSat.hue = run.loop > 0 ? ((run.loop * 1.1) % (Math.PI * 2)) - Math.PI : 0;
    run.refresh(true);
    this.music.pattern = run.pattern;
    this.music.backing = this.venue.progression;
    this.music.dropUntil = -1;
    this.music.dropAtBar = -1;
    this.music.hushed = false;
    this.silenced = false;
    this.dropState = run.hype >= 1 ? 'ready' : 'idle';
    this.updateTempo();
    this.band.sync(run.pattern.tracks.map((t) => ({ inst: t.inst, evolved: t.evolved })));
    this.hud.setVisible(true);
    this.hud.boss(null);
    this.state = 'playing';
    this.muffleTarget = 0;
    const loopTag = run.loop > 0 ? ` · AFTER HOURS ${run.loop}` : '';
    this.hud.announce(this.venue.name + loopTag, this.venue.tagline, '#' + this.venue.palette.accents[0]!.toString(16).padStart(6, '0'), 3.4);
    V.crowdCheer(this.audio, this.audio.now + 0.1, 0.4 + index * 0.3, 3);
  }

  private setVenue(index: number): void {
    const next = index === 0 ? new Basement() : index === 1 ? new Cathedral() : new Mainstage();
    this.world.remove(this.venue.group);
    this.venue.dispose();
    this.venue = next;
    this.world.add(this.venue.group);
    this.applyVenueLook();
    // compile every program now so the first spawn/explosion never hitches
    this.stage.renderer.compile(this.stage.scene, this.stage.camera);
  }

  private applyVenueLook(): void {
    const p = this.venue.palette;
    this.stage.scene.background = new THREE.Color(p.background);
    this.stage.scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    this.enemies.setColors(p.rim, p.floor);
    this.playerModel.setHaloPalette(p.accents);
    this.playerModel.coreColor.setHex(p.core);
    this.audio.setRoom(this.venue.id === 'cathedral' ? 5 : this.venue.id === 'mainstage' ? 3 : 1.6, this.venue.id === 'cathedral' ? 2 : 3, 1);
  }

  private clearWorld(): void {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.glow.clear();
    this.dark.clear();
    this.ground.clear();
    this.shadowFx.clear();
    this.beams.clear();
    this.numbers.clear();
    this.scheduled.length = 0;
    if (this.boss) {
      this.world.remove(this.boss.group);
      this.boss.dispose();
      this.boss = null;
    }
  }

  private updateTempo(): void {
    const run = this.run;
    if (!run) return;
    const bpm = this.venue.bpm + run.stats.bpmBonus + run.loop * 8;
    this.transport.setBpm(bpm);
    this.audio.setTempo(bpm);
  }

  private endRun(won: boolean, quit = false): void {
    const run = this.run;
    if (!run) return this.toTitle();
    this.state = 'results';
    this.hud.setVisible(false);
    this.pauseUi.setVisible(false);
    this.draftUi.close();
    this.music.pattern = run.pattern;
    this.muffleTarget = 0.55;
    const cleared = run.loop * 3 + run.venueIndex + (won ? 1 : 0);
    const fans = Math.round(
      (run.kills / 18 + cleared * 70 + run.level * 4 + (won ? 250 : 0) + run.perfects) * (1 + run.loudness * 0.3) * (quit ? 0.5 : 1),
    );
    this.save.fans += fans;
    this.save.totalFans += fans;
    this.lastFans = fans;
    if (won) this.save.wins = Math.max(this.save.wins, run.loudness + 1);
    const newBestKills = run.kills > this.save.bestKills && this.save.runs > 1;
    const newBestHit = run.bestHit > this.save.bestHit && this.save.runs > 1;
    this.save.bestKills = Math.max(this.save.bestKills, run.kills);
    this.save.bestVenue = Math.max(this.save.bestVenue, cleared);
    this.save.bestHit = Math.max(this.save.bestHit, run.bestHit);
    for (const g of run.discovered) if (!this.save.grooves.includes(g)) this.save.grooves.push(g);
    for (const t of run.pattern.tracks) if (t.evolved && !this.save.evolutions.includes(t.inst)) this.save.evolutions.push(t.inst);
    if (run.mode === 'daily') {
      const k = dailyKey(new Date());
      this.save.dailyBest[k] = Math.max(this.save.dailyBest[k] ?? 0, run.kills);
    }
    writeSave(this.save);
    this.results.open({
      won,
      venueName: VENUE_NAMES[run.venueIndex] ?? 'THE VENUE',
      venuesCleared: cleared,
      kills: run.kills,
      level: run.level,
      bestHit: run.bestHit,
      perfects: run.perfects,
      drops: run.drops,
      time: run.time,
      fans,
      newGrooves: this.newGroovesThisRun,
      grooves: [...run.discovered].map((g) => ({ genre: GROOVES[g].genre, color: GROOVES[g].color })),
      pattern: run.pattern.serialize(),
      tracks: run.pattern.tracks.map((t) => ({ short: INSTRUMENTS[t.inst].short, css: INSTRUMENTS[t.inst].css, notes: [...t.notes] })),
      seedCode: seedToCode(run.seed),
      daily: run.mode === 'daily',
      bestStreak: run.bestStreak,
      loop: run.loop,
      newBestKills,
      newBestHit,
    });
    this.resultsWon = won;
    if (won) {
      V.crowdCheer(this.audio, this.audio.now, 1.2, 5);
      this.music.fanfare(true);
    }
  }

  private resultsWon = false;

  private async savePoster(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const blob = await renderPoster({
      won: this.resultsWon,
      venueName: VENUE_NAMES[run.venueIndex] ?? 'THE VENUE',
      kills: run.kills,
      bestHit: run.bestHit,
      level: run.level,
      time: run.time,
      fans: this.lastFans,
      seedCode: seedToCode(run.seed),
      daily: run.mode === 'daily',
      grooves: [...run.discovered].map((g) => ({ genre: GROOVES[g].genre, color: GROOVES[g].color })),
      tracks: run.pattern.tracks.map((t) => ({
        short: INSTRUMENTS[t.inst].short,
        css: INSTRUMENTS[t.inst].css,
        notes: [...t.notes],
        icon: this.icons.instrument(t.inst),
      })),
    });
    if (blob) downloadBlob(blob, `encore-${seedToCode(run.seed).toLowerCase()}.png`);
  }

  private lastFans = 0;

  private onResultsPrimary(): void {
    const run = this.run;
    if (this.resultsWon && run) {
      // keep the same build: the encore loop
      this.results.setVisible(false);
      run.loop++;
      run.hp = run.stats.maxHp;
      this.beginVenue(0);
      return;
    }
    this.startRun(run?.mode === 'daily' ? 'standard' : (run?.mode ?? 'standard'));
  }

  /* ───────────────────────────── pause / settings ───────────────────────────── */

  private pause(): void {
    if (this.state !== 'playing') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.pauseUi.setVisible(true);
    this.muffleTarget = 0.75;
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.pauseUi.setVisible(false);
    this.settingsUi.close();
    this.howto.setVisible(false);
    this.state = this.prevState === 'paused' ? 'playing' : this.prevState;
    this.muffleTarget = 0;
    this.input.clearLatched();
    void this.audio.resume();
  }

  private applySettings(s: Settings, persist = true): void {
    const q = this.save.settings.quality;
    this.save.settings = s;
    this.audio.setVolumes(this.muted ? 0 : s.master, s.music, s.sfx);
    if (s.quality !== q || !persist) this.stage.setQuality(QUALITY[s.quality]);
    document.body.classList.toggle('no-flash', !s.flashes);
    if (persist) writeSave(this.save);
  }

  private cycleSetlist(dir: number): void {
    const i = SETLIST_IDS.indexOf(this.save.setlist as SetlistId);
    const next = SETLIST_IDS[(i + dir + SETLIST_IDS.length) % SETLIST_IDS.length]!;
    this.save.setlist = next;
    writeSave(this.save);
    this.title.update(this.save, dailyKey(new Date()), this.sharedSeed !== null ? seedToCode(this.sharedSeed) : null);
    V.uiClick(this.audio, this.audio.now, dir > 0 ? 4 : -2);
  }

  private openMerch(): void {
    this.merch.open(this.save);
  }

  private buyUnlock(id: InstrumentId): void {
    const cost = UNLOCK_COST[id];
    if (cost === undefined || this.save.unlocked.includes(id)) return;
    if (this.save.fans < cost) {
      V.uiError(this.audio, this.audio.now);
      return;
    }
    this.save.fans -= cost;
    this.save.unlocked.push(id);
    writeSave(this.save);
    this.music.fanfare(true);
    this.merch.open(this.save);
    this.title.update(this.save, dailyKey(new Date()));
  }

  /* ───────────────────────────── main loop ───────────────────────────── */

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(rawDt);
  };

  private frame(rawDt: number): void {
    prof.begin('frame');
    const overlay = this.state === 'draft' || this.state === 'backstage' || this.state === 'paused' || this.state === 'results';
    if (overlay !== this.overlayOpen) {
      this.overlayOpen = overlay;
      document.body.classList.toggle('overlay-open', overlay);
    }
    this.transport.pump(this.audio.now);
    const audible = this.audio.audibleTime();
    const beatPhase = this.transport.running ? this.transport.beatPhase(audible) : 0.5;
    this.currentStep = this.transport.running
      ? ((Math.floor(this.transport.positionAt(audible)) % 16) + 16) % 16
      : 0;
    this.audio.spectrum(this.spectrum);
    this.handleGlobalKeys();

    // hit-stop & slow-mo only affect the simulation, never the music
    let dt = rawDt;
    if (this.hitStop > 0) {
      this.hitStop -= rawDt;
      dt *= 0.04;
    } else if (this.slowMo > 0) {
      this.slowMo -= rawDt;
      dt *= 0.3;
    }
    this.time += rawDt;

    switch (this.state) {
      case 'title':
        this.music.drain(audible, null);
        this.transport.drain(audible, (ev) => this.venue.onStep(ev.step, ev.bar));
        this.updateTitle(rawDt, beatPhase);
        break;
      case 'playing':
        this.updatePlaying(dt, rawDt, audible, beatPhase);
        break;
      case 'dying':
        this.music.drain(audible, null);
        this.transport.drain(audible, () => undefined);
        this.dyingT -= rawDt;
        this.updateVisuals(dt * 0.3, rawDt, beatPhase);
        if (this.dyingT <= 0) this.endRun(false);
        break;
      case 'outro':
        this.music.drain(audible, null);
        this.transport.drain(audible, (ev) => this.venue.onStep(ev.step, ev.bar));
        this.updateOutro(rawDt, beatPhase);
        break;
      default:
        if (this.autopilot && this.state === 'backstage') this.leaveBackstage();
        // draft / paused / backstage / results: the band plays on, the world holds its breath
        this.music.drain(audible, null);
        this.transport.drain(audible, (ev) => this.venue.onStep(ev.step, ev.bar));
        this.updateVisuals(0, rawDt, beatPhase);
        this.editor?.tick(this.currentStep);
        if (this.state === 'draft' || this.state === 'backstage') this.processStamps(rawDt);
        if (this.state === 'draft') this.draftKeys();
        break;
    }

    // audio muffle: pause/draft/hurt/damper
    const hurt = this.muffleHurt;
    this.muffleHurt = Math.max(0, this.muffleHurt - rawDt * 2);
    this.audio.setMuffle(Math.max(this.muffleTarget, hurt * 0.5, this.silenced ? 0.62 : 0));

    prof.begin('render');
    this.stage.render(rawDt);
    prof.end('render');
    this.watchPerformance(rawDt);
    prof.end('frame');
  }

  private handleGlobalKeys(): void {
    if (this.input.take('mute')) {
      this.muted = !this.muted;
      this.audio.setVolumes(this.muted ? 0 : this.save.settings.master, this.save.settings.music, this.save.settings.sfx);
      this.hud.toast(this.muted ? 'MUTED' : 'SOUND ON');
    }
    if (this.input.take('pause')) {
      if (this.settingsUi.isOpen) this.settingsUi.close();
      else if (this.howto.isOpen) this.howto.setVisible(false);
      else if (this.merch.isOpen) this.merch.close();
      else if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.input.take('confirm')) {
      if (this.state === 'title' && this.title.revealed && !this.merch.isOpen && !this.howto.isOpen && !this.settingsUi.isOpen)
        this.startRun('standard');
      else if (this.state === 'draft') this.draftUi.finish();
      else if (this.state === 'results') this.onResultsPrimary();
    }
  }

  private updateTitle(dt: number, beatPhase: number): void {
    this.titleCam += dt * 0.25;
    const kick = Math.pow(1 - beatPhase, 3);
    // framing: the stage, the frontman at the mic stand, the neon above
    this.rig.target.set(-8.5 + Math.sin(this.titleCam) * 0.8, 7.6, -24);
    this.rig.distance = 30 + Math.sin(this.titleCam * 0.7) * 0.8;
    this.rig.pitch = 0.16;
    this.rig.yaw = -0.1;
    this.rig.setLookAhead(0, 0);
    this.rig.update(dt);
    this.sign.update(dt, kick);
    this.title.pulse(kick);
    this.playerModel.baseY = 3.4;
    this.playerModel.showFloorFx = false;
    this.playerModel.update(dt, this.time, 0, -22.4, Math.sin(this.time * 0.5) * 0.4, 0, beatPhase, this.spectrum, false, false);
    this.venue.update({
      dt,
      time: this.time,
      beatPhase,
      barPhase: this.transport.barPhase(this.audio.audibleTime()),
      energy: 0.45,
      drop: false,
      spectrum: this.spectrum,
      playerX: 0,
      playerZ: 2,
      bossActive: false,
      build: 0,
    });
    this.setVenueBar();
    if (Math.random() < 0.08) {
      this.glow.emit({
        x: (Math.random() - 0.5) * 50,
        y: 0.5,
        z: (Math.random() - 0.5) * 30,
        vy: 1.2,
        life: 3,
        size: 0.25,
        color: this.venue.palette.accents[Math.floor(Math.random() * 4)]!,
        shape: Shape.Note,
        alpha: 0.7,
      });
    }
    this.glow.update(dt);
    this.ground.update(dt);
  }

  private setVenueBar(): void {
    const v = this.venue as unknown as { setBar?: (b: number) => void };
    if (v.setBar) v.setBar(this.transport.positionAt(this.audio.audibleTime()) / 16);
  }

  /* ───────────────────────────── gameplay ───────────────────────────── */

  private updatePlaying(dt: number, rawDt: number, audible: number, beatPhase: number): void {
    const run = this.run!;
    run.time += dt;
    const p = this.player;

    this.updatePlayer(dt, audible);

    // weapons fire when their note is heard
    prof.begin('notes');
    this.music.drain(audible, (n) => this.onNote(n));
    this.transport.drain(audible, (ev) => this.onStepEvent(ev));
    prof.end('notes');

    // boss (a defeated boss is inert: its enemy slot may already be recycled)
    if (this.boss && !this.boss.dead) {
      this.bossCtx.px = p.x;
      this.bossCtx.pz = p.z;
      this.bossCtx.playerInvuln = p.invuln > 0 || p.dashT > 0;
      this.bossCtx.hpMult = this.director?.hpMult(0) ?? 1;
      this.bossCtx.camQuat.copy(this.stage.camera.quaternion);
      this.boss.update(this.bossCtx, dt, this.time, beatPhase);
      this.hud.boss(this.boss.name, this.boss.hpFrac, this.boss.armor < 0.5);
      if (this.boss.entry && !this.boss.entry.alive && !this.boss.dead) this.onBossDefeated();
    }
    if (this.bossDownT > 0) {
      this.bossDownT -= rawDt;
      if (this.bossDownT <= 0) this.afterBoss();
    }

    if (this.autopilot && Math.floor(run.time) !== Math.floor(run.time - dt)) {
      this.autoLog.push({
        t: Math.round(run.time),
        lvl: run.level,
        hp: Math.round(run.hp),
        kills: run.kills,
        alive: this.enemies.aliveCount,
        venue: run.venueIndex,
        dmg: Math.round(run.damage),
      });
    }
    // set progression → headliner
    run.setTime += dt;
    if (this.director && !this.director.bossTriggered && run.setTime >= this.director.length) {
      this.director.bossTriggered = true;
      this.spawnBoss();
    }

    // enemies
    prof.begin('enemies');
    this.enemies.rebuildHash();
    this.enemies.update(
      dt,
      p.x,
      p.z,
      this.venue.bounds,
      this.venue.obstacles,
      {
        shoot: (e, dx, dz) => this.enemyShoot(e.x, e.z, dx * 11, dz * 11, 0.5),
        telegraph: (x, z, r, d, c) => this.ground.add(GroundKind.Telegraph, x, z, r, r, d, c, { fixed: true, alpha: 0.8 }),
      },
      (1 + run.loop * 0.08) * (1 - this.buildT * 0.7),
    );
    this.contactDamage();
    this.damperCheck(dt);
    prof.end('enemies');
    prof.begin('projectiles');

    this.projectiles.update(
      dt,
      this.enemies,
      p.x,
      p.z,
      p.radius * 0.8,
      this.venue.bounds,
      { hit: (pr, e) => this.projectileHit(pr, e), hitPlayer: (pr) => this.hurt(8 * (1 + run.venueIndex * 0.35), pr.x, pr.z) },
      this.glow,
      this.dark,
      false,
    );

    prof.end('projectiles');
    prof.begin('pickups');
    this.pickups.update(dt, this.time, p.x, p.z, run.stats.pickupRadius, (pk) => this.collect(pk));
    this.flushNumbers(dt);
    prof.end('pickups');

    // scheduled weapon follow-ups
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      const s = this.scheduled[i]!;
      s.t -= dt;
      if (s.t <= 0) {
        this.scheduled.splice(i, 1);
        s.fn();
      }
    }

    // streaks
    this.streakT -= dt;
    if (this.streakT <= 0 && this.streak > 0) {
      if (this.streak >= 50) this.hud.toast(`STREAK ×${formatInt(this.streak)}`, '#ffe14d');
      this.streak = 0;
    }
    this.pickupChainT -= dt;
    if (this.pickupChainT <= 0) this.pickupChain = 0;

    // build-up: filter sweep opens, tunnel vision closes in, the room holds its breath
    if (this.dropState === 'queued') {
      this.buildT = clamp((audible - this.buildStart) / Math.max(0.1, this.buildEnd - this.buildStart), 0, 1);
      this.muffleTarget = 0.72 * (1 - this.buildT) * (audible >= this.buildStart ? 1 : 0);
    } else if (this.buildT > 0) {
      this.buildT = Math.max(0, this.buildT - rawDt * 4);
      if (this.state === 'playing') this.muffleTarget = 0;
    }
    this.stage.buildUp = this.buildT;
    // drop state
    if (this.dropState === 'idle' && run.hype >= 1) {
      this.dropState = 'ready';
      this.hud.toast('HYPE FULL — PRESS Q TO DROP', '#ffb13d');
      V.bell(this.audio, this.audio.now, 88, 0.6);
    }
    if (this.dropState === 'active') {
      run.hype = Math.max(0, run.hype - dt / Math.max(1, run.stats.dropBars * this.transport.stepDur * 16));
      if (this.transport.bar > this.music.dropUntil) {
        this.dropState = 'idle';
        run.hype = 0;
      }
    }

    // levels
    if (run.pendingDrafts > 0 || run.pendingGold > 0) {
      if (this.announceCooldown <= 0) this.openDraft(run.pendingGold > 0);
    }

    prof.begin('visuals');
    this.updateVisuals(dt, rawDt, beatPhase);
    prof.end('visuals');
    prof.begin('hud');
    this.hud.update(
      run,
      rawDt,
      this.venue.name,
      run.setTime,
      this.director?.length ?? 1,
      this.currentStep,
      p.charges,
      p.maxCharges,
      beatPhase,
      this.streak,
      this.dropState,
    );
    prof.end('hud');
    if (this.rig.toScreen(p.x, 1, p.z, this.scr)) this.hud.setBottomFade(this.scr.y > window.innerHeight * 0.7);
    this.processAnnouncements(rawDt);
  }

  /** Dev-only bot: kites away from threats so balance can be measured headlessly. */
  private autopilot = false;
  private autoLog: { t: number; lvl: number; hp: number; kills: number; alive: number; venue: number; dmg: number }[] = [];

  private botMove(): { x: number; y: number } {
    const p = this.player;
    let fx = 0;
    let fz = 0;
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 144) continue;
      const w = (e.scripted ? 6 : 1) / Math.max(1, d2);
      fx += dx * w;
      fz += dz * w;
    }
    for (const pr of this.projectiles.list) {
      if (!pr.alive || pr.kind !== 'enemy') continue;
      const dx = p.x - pr.x;
      const dz = p.z - pr.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 36) continue;
      // sidestep: push perpendicular to the bullet's travel, away from its line
      const l = Math.hypot(pr.vx, pr.vz) || 1;
      const side = Math.sign(dx * -pr.vz / l + dz * pr.vx / l) || 1;
      fx += ((-pr.vz / l) * side * 6) / Math.max(1, d2);
      fz += ((pr.vx / l) * side * 6) / Math.max(1, d2);
    }
    // drift toward the centre and toward pickups so the bot doesn't hug walls
    fx += -p.x * 0.004;
    fz += -p.z * 0.004;
    const pk = this.pickups.list.find((q) => q.alive && Math.hypot(q.x - p.x, q.z - p.z) < 10);
    if (pk) {
      fx += (pk.x - p.x) * 0.01;
      fz += (pk.z - p.z) * 0.01;
    }
    // circle-strafe component
    const l = Math.hypot(fx, fz);
    if (l < 1e-4) return { x: Math.sin(this.time * 0.7), y: Math.cos(this.time * 0.5) };
    const tx = -fz / l;
    const tz = fx / l;
    const x = fx / l + tx * 0.6;
    const y = fz / l + tz * 0.6;
    const m = Math.hypot(x, y) || 1;
    if ((this.enemies.nearest(p.x, p.z, 2.4) || this.boss?.threat(p.x, p.z)) && p.charges > 0) this.input.latch('dash');
    if (this.dropState === 'ready') this.input.latch('drop');
    return { x: x / m, y: y / m };
  }

  private updatePlayer(dt: number, audible: number): void {
    const p = this.player;
    const run = this.run!;
    const mv = this.autopilot ? this.botMove() : this.input.move();
    const speed = run.stats.moveSpeed;
    // aim
    let manual = false;
    if (this.input.gamepadAim) {
      p.aimX = this.input.gamepadAim.x;
      p.aimZ = this.input.gamepadAim.z;
      manual = true;
    } else if (!this.save.settings.autoAim && !this.autopilot && this.input.mouseActive) {
      const g = this.rig.groundFromScreen(this.input.mouseX, this.input.mouseY, this.aimV);
      if (g) {
        const dx = g.x - p.x;
        const dz = g.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3) {
          p.aimX = dx / d;
          p.aimZ = dz / d;
        }
        manual = true;
      }
    }
    this.weaponCtx.manualAim = manual;

    // dash
    p.rechargeT -= dt;
    if (p.charges < p.maxCharges && p.rechargeT <= 0) {
      p.charges++;
      p.rechargeT = 1.35;
    }
    if (this.input.take('dash') && p.charges > 0 && p.dashT <= 0) {
      const dirX = Math.hypot(mv.x, mv.y) > 0.1 ? mv.x : p.aimX;
      const dirZ = Math.hypot(mv.x, mv.y) > 0.1 ? mv.y : p.aimZ;
      const l = Math.hypot(dirX, dirZ) || 1;
      p.dashX = dirX / l;
      p.dashZ = dirZ / l;
      p.dashT = 0.17 * run.stats.dashDist;
      p.charges--;
      if (p.charges < p.maxCharges && p.rechargeT <= 0) p.rechargeT = 1.35;
      // judge against the audible beat at the moment of the key press
      const pressAudible = audible - (performance.now() - this.input.dashPressedAt) / 1000;
      const off = this.transport.offsetToGrid(pressAudible, 4);
      if (Math.abs(off) <= run.stats.perfectWindow) this.perfectDash();
      else {
        V.whoosh(this.audio, this.audio.now, 0.7, true, 0.18);
        p.invuln = Math.max(p.invuln, 0.22);
      }
    }
    if (this.input.take('drop')) this.callDrop();

    let vx: number;
    let vz: number;
    if (p.dashT > 0) {
      p.dashT -= dt;
      const ds = 34;
      vx = p.dashX * ds;
      vz = p.dashZ * ds;
      if (Math.random() < 0.9)
        this.glow.emit({ x: p.x, y: 1.1, z: p.z, life: 0.3, size: 1.2, sizeEnd: 0.2, color: this.venue.palette.core, shape: Shape.Dot, alpha: 0.5 });
    } else {
      p.vx = damp(p.vx, mv.x * speed, 16, dt);
      p.vz = damp(p.vz, mv.y * speed, 16, dt);
      vx = p.vx;
      vz = p.vz;
    }
    p.x += vx * dt;
    p.z += vz * dt;
    pushOutOfObstacles(this.venue.obstacles, p.x, p.z, p.radius, this.tmp);
    clampToBounds(this.venue.bounds, this.tmp.x, this.tmp.z, p.radius, this.tmp);
    p.x = this.tmp.x;
    p.z = this.tmp.z;
    p.invuln = Math.max(0, p.invuln - dt);
    if (Math.hypot(vx, vz) > 0.5) p.facing = Math.atan2(vx, vz);
    p.tilt = damp(p.tilt, Math.min(1, Math.hypot(vx, vz) / speed), 8, dt);
  }

  private perfectDash(): void {
    const p = this.player;
    const run = this.run!;
    run.perfects++;
    p.invuln = Math.max(p.invuln, 0.5);
    if (run.pedals.metronome > 0 && p.charges < p.maxCharges) p.charges++;
    this.addHype(0.08);
    this.hud.flashPerfect();
    const core = new THREE.Color(this.venue.palette.core);
    const t = this.audio.now;
    V.bell(this.audio, t, 81, 0.8, undefined, 0.6);
    V.bell(this.audio, t + 0.04, 88, 0.6, undefined, 0.6);
    V.whoosh(this.audio, t, 1, true, 0.2);
    // shockwave at the launch point
    const dmg = 22 * run.stats.perfectDmg * (1 + run.level * 0.12) * run.stats.dmgMult;
    const r = 3.4 * run.stats.area;
    this.enemies.hash.query(p.x, p.z, r + 1.5, (i) => {
      const e = this.enemies.list[i]!;
      if (!e.alive) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > r + e.radius) return;
      this.damage(e, dmg, { color: core, inst: null, kx: dx / d, kz: dz / d, knock: 9 });
    });
    this.ground.add(GroundKind.Shock, p.x, p.z, 0.5, r, 0.35, core, { thickness: 0.12 });
    this.ground.add(GroundKind.Ring, p.x, p.z, 0.5, r * 1.6, 0.5, 0xffffff, { thickness: 0.04 });
    this.glow.burst(p.x, 1, p.z, 22, core, 10, { life: 0.45, size: 0.4, shape: Shape.Spark });
    this.venue.ripple(p.x, p.z, core, 0.8);
    this.stage.aberrationKick = Math.min(1, this.stage.aberrationKick + 0.5);
    this.rig.punch(2.5);
    this.slowMo = Math.max(this.slowMo, 0.08);
  }

  private callDrop(): void {
    const run = this.run!;
    if (this.dropState !== 'ready' || run.hype < 1) {
      if (this.dropState === 'idle') V.uiError(this.audio, this.audio.now);
      return;
    }
    const now = this.audio.now;
    const down = this.transport.nextDownbeat(now + 0.13);
    const bar = this.transport.bar;
    let dropBar: number;
    let riserStart: number;
    let riserEnd: number;
    const barDur = this.transport.stepDur * 16;
    // the next bar that hasn't been scheduled yet
    const scheduledBar = this.transport.step === 0 ? bar : bar + 1;
    if (down - now >= 0.9) {
      dropBar = scheduledBar;
      riserStart = now;
      riserEnd = down;
    } else {
      dropBar = scheduledBar + 1;
      riserStart = down;
      riserEnd = down + barDur;
    }
    this.music.dropAtBar = dropBar;
    this.music.dropUntil = dropBar + run.stats.dropBars - 1;
    V.riser(this.audio, riserStart, riserEnd - riserStart);
    this.buildStart = riserStart;
    this.buildEnd = riserEnd;
    this.dropState = 'queued';
    this.hud.clearToasts();
  }

  private onStepEvent(ev: StepEvent): void {
    this.venue.onStep(ev.step, ev.bar);
    const run = this.run!;
    if (ev.step === 0 && ev.bar === this.music.dropAtBar && this.dropState === 'queued') this.detonateDrop();
    else if (this.dropState === 'queued' && ev.step % 4 === 0 && ev.time >= this.buildStart - 0.05) {
      const beatsLeft = Math.round((this.buildEnd - ev.time) / (this.transport.stepDur * 4));
      if (beatsLeft >= 1 && beatsLeft <= 4) {
        const on = this.rig.toScreen(this.player.x, 2, this.player.z, this.scr);
        this.hud.countdown(String(beatsLeft), on ? this.scr.x : undefined, on ? this.scr.y : undefined);
        V.tom(this.audio, this.audio.now, 0.5, 12 - beatsLeft * 2);
      }
    }
    if (ev.step % 4 === 0 && this.director) {
      const orders = this.director.onBeat(run.setTime, this.transport.stepDur * 4, this.enemies.aliveCount, !!this.boss);
      for (const o of orders) this.release(o.kind, o.count, o.elite, o.ring);
    }
    if (this.boss && !this.boss.dead && this.boss.entry?.alive) this.boss.onStep(this.bossCtx, ev.step, ev.bar);
    // THE ONE: downbeat nova
    if (ev.step === 0 && run.grooves.active.has('downbeat')) {
      const r = 6 * run.stats.area;
      const dmg = 30 * (1 + run.level * 0.1) * run.stats.dmgMult;
      const col = new THREE.Color(0xfff1b8);
      this.enemies.hash.query(this.player.x, this.player.z, r + 1, (i) => {
        const e = this.enemies.list[i]!;
        if (e.alive) this.damage(e, dmg, { color: col, inst: null, knock: 4, kx: e.x - this.player.x, kz: e.z - this.player.z });
      });
      this.ground.add(GroundKind.Shock, this.player.x, this.player.z, 1, r, 0.4, col, { thickness: 0.07 });
    }
  }

  private release(kind: import('../render/hush').HushKind, count: number, elite: boolean, ring: boolean): void {
    const run = this.run!;
    const hp = this.director!.hpMult(run.setTime);
    const p = this.player;
    if (ring) {
      const r = 15;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        clampToBounds(this.venue.bounds, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 1, this.tmp);
        const e = this.enemies.spawn(kind, this.tmp.x, this.tmp.z, hp);
        if (e) this.spawnPuff(e);
      }
      this.hud.toast('THEY SURROUND YOU', '#ff3b5c');
      V.roar(this.audio, this.audio.now, 0.35);
      return;
    }
    this.venue.spawnPoint(run.spawnRng, p.x, p.z, this.tmp);
    const bx = this.tmp.x;
    const bz = this.tmp.z;
    for (let i = 0; i < count; i++) {
      const e = this.enemies.spawn(kind, bx + (Math.random() - 0.5) * 3, bz + (Math.random() - 0.5) * 3, hp, elite);
      if (e) this.spawnPuff(e);
      if (e && elite) {
        this.hud.toast(kind === 'bouncer' ? 'A BOUNCER BLOCKS THE WAY' : 'ELITE HUSH INCOMING', '#ffc53d');
        V.roar(this.audio, this.audio.now, 0.5);
      }
    }
  }

  private spawnPuff(e: Enemy): void {
    this.dark.burst(e.x, 0.6, e.z, 5, 0x120818, 3, { life: 0.5, size: 0.9, sizeEnd: 1.6, alpha: 0.5 });
  }

  private enemyShoot(x: number, z: number, vx: number, vz: number, r = 0.5): void {
    this.projectiles.spawn({ kind: 'enemy', x, z, vx, vz, dmg: 10, radius: r, life: 6 });
  }

  private onNote(n: NoteEvent): void {
    const run = this.run!;
    const t = run.pattern.track(n.inst);
    if (!t) return;
    const harmony = 1 + run.stats.harmonyPer * Math.max(0, n.harmony - 1);
    const drop = this.dropState === 'active' ? 2 : 1;
    const silence = this.silenced ? 0.5 : 1;
    const mult = harmony * (n.accent ? 2 : 1) * (n.ghost ? 0.6 : 1) * drop * silence;
    this.band.hit(n.inst, n.ghost ? 0.4 : n.accent ? 1.2 : 0.8);
    this.venue.onNote?.(n.inst, n.ghost ? 0.4 : 1);
    fireTrack(this.weaponCtx, t, { step: n.step, mult, accent: n.accent, ghost: n.ghost });
  }

  private projectileHit(pr: Projectile, e: Enemy): void {
    const color = pr.color;
    this.damage(e, pr.dmg, {
      color,
      inst: pr.inst,
      kx: pr.vx / (pr.speed || 1),
      kz: pr.vz / (pr.speed || 1),
      knock: pr.kind === 'pellet' ? 3 : pr.kind === 'disc' ? 1.5 : 2,
      crit: pr.crit,
      stun: pr.stun,
    });
    this.glow.burst(pr.x, 1, pr.z, 3, color, 4, { life: 0.2, size: 0.3, shape: Shape.Spark });
    if (pr.splitOnHit > 0 && pr.kind !== 'disc') {
      const n = pr.splitOnHit;
      pr.splitOnHit = 0;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        this.projectiles.spawn({
          kind: pr.kind === 'missile' ? 'missile' : 'pellet',
          inst: pr.inst,
          x: pr.x,
          z: pr.z,
          vx: Math.cos(a) * 20,
          vz: Math.sin(a) * 20,
          dmg: pr.dmg * 0.5,
          radius: 0.35,
          life: 0.8,
          homing: pr.kind === 'missile' ? 6 : 0,
          color,
        });
      }
    }
  }

  /** The one place damage is dealt to enemies. */
  private damage(e: Enemy, amount: number, o: HitOpts): void {
    if (!e.alive) return;
    const run = this.run!;
    let dmg = amount;
    if (e.scripted && this.boss && this.boss.entry === e) dmg *= this.boss.armor;
    if (e.freeze > 0 && run.pattern.track('gong')?.evolved) dmg *= 3;
    e.hp -= dmg;
    e.flash = Math.max(e.flash, 0.55);
    if (o.knock && !e.scripted) {
      const k = o.knock / e.mass;
      const l = Math.hypot(o.kx ?? 0, o.kz ?? 0) || 1;
      e.kx += ((o.kx ?? 0) / l) * k * 4;
      e.kz += ((o.kz ?? 0) / l) * k * 4;
    }
    if (o.stun) e.stun = Math.max(e.stun, o.stun);
    if (o.freeze) e.freeze = Math.max(e.freeze, o.freeze);
    if (o.slow) e.slow = Math.max(e.slow, o.slow);
    run.damage += dmg;
    if (dmg > run.bestHit) run.bestHit = dmg;
    if (!o.quiet) {
      // accumulate; flushed as one number per enemy every ~0.18s (or on death)
      if (e.numAcc === 0) e.numT = 0.28;
      e.numAcc += dmg;
      e.numCrit = e.numCrit || !!o.crit;
      e.numColor = o.color.getHex();
      if (this.audio.allowHit(5)) V.tick(this.audio, this.audio.now, 0.6);
    }
    if (e.hp <= 0) this.kill(e, o);
  }

  private numBudget = 0;
  private numBudgetT = 0;

  private flushNumber(e: Enemy): void {
    if (e.numAcc <= 0) return;
    const run = this.run!;
    const dmg = e.numAcc;
    const big = dmg > 300 * (1 + run.venueIndex * 2 + run.loop * 4);
    if (this.time - this.numBudgetT > 0.15) {
      this.numBudgetT = this.time;
      this.numBudget = 0;
    }
    if (++this.numBudget > 5 && !e.numCrit && !big && !e.scripted) {
      e.numAcc = 0;
      return;
    }
    const color = e.numCrit ? 0xffe14d : big ? 0xff4df0 : e.numColor;
    const byDamage = Math.min(1.35, 0.45 + Math.log10(dmg + 1) * 0.16);
    const size = byDamage * (e.numCrit ? 1.3 : 1) * (big ? 1.25 : 1) * (e.scripted ? 1.2 : 1);
    this.numbers.spawn(e.x, 2.2 + e.radius, e.z, dmg, color, size);
    e.numAcc = 0;
    e.numCrit = false;
  }

  private flushNumbers(dt: number): void {
    for (const e of this.enemies.list) {
      if (!e.alive || e.numAcc <= 0) continue;
      e.numT -= dt;
      if (e.numT <= 0) this.flushNumber(e);
    }
  }

  private kill(e: Enemy, o: HitOpts): void {
    const run = this.run!;
    this.flushNumber(e);
    if (e.scripted) {
      e.hp = 0;
      e.alive = false;
      return;
    }
    e.alive = false;
    run.kills++;
    this.streak++;
    this.streakT = 1.6;
    run.bestStreak = Math.max(run.bestStreak, this.streak);
    const color = o.color;
    // loot
    const xp = e.xp * (1 + run.loop * 0.5);
    if (xp > 0) {
      if (xp > 20) {
        const parts = Math.min(6, Math.ceil(xp / 12));
        for (let i = 0; i < parts; i++) this.pickups.spawn('xp', e.x, e.z, xp / parts, 1.6);
      } else this.pickups.spawn('xp', e.x, e.z, xp);
    }
    if (e.elite) {
      this.pickups.spawn('record', e.x, e.z, 1, 1.2);
      for (let i = 0; i < 5; i++) this.pickups.spawn('tip', e.x, e.z, 3, 2);
      this.hitStop = Math.max(this.hitStop, 0.07);
      this.rig.addTrauma(0.35 * this.save.settings.shake);
      V.crowdCheer(this.audio, this.audio.now, 0.6, 1.6);
      this.venue.ripple(e.x, e.z, color, 1);
      this.glow.burst(e.x, 1.2, e.z, 60, 0xffc53d, 16, { vy: 12, life: 0.9, size: 0.5, shape: Shape.Square, gravity: 16, spin: 8 });
    } else if (run.lootRng.chance(0.035 * run.stats.tipsMult)) {
      this.pickups.spawn('tip', e.x, e.z, 1);
    }
    if (run.lootRng.chance(0.011)) this.pickups.spawn('heart', e.x, e.z, 1);

    // the Hush bursts into light & sound
    const n = e.kind === 'mote' || e.kind === 'wisp' ? 10 : 18;
    this.glow.burst(e.x, 0.9, e.z, n, color, 9, { vy: 7, life: 0.55, size: 0.38, shape: Shape.Spark, gravity: 10 });
    this.glow.emit({ x: e.x, y: 1, z: e.z, life: 0.16, size: 0.9 * e.scale, sizeEnd: 2.2 * e.scale, color, shape: Shape.Ring, alpha: 0.55 });
    if (Math.random() < 0.5)
      this.glow.emit({ x: e.x, y: 1.2, z: e.z, vy: 3.5, life: 0.9, size: 0.7, color, shape: Shape.Note, alpha: 0.9 });
    this.dark.burst(e.x, 0.6, e.z, 4, 0x0c0612, 2, { life: 0.45, size: 0.8, sizeEnd: 1.6, alpha: 0.55 });
    // the eyes go out last
    const eh = e.kind === 'mute' ? 2.0 * e.scale : e.kind === 'shusher' ? 2.1 * e.scale : 0.75 * e.scale;
    for (const s of [-1, 1]) {
      this.glow.emit({ x: e.x + s * 0.2 * e.scale, y: eh, z: e.z + 0.2, vy: 0.6, life: 0.5, size: 0.32 * e.scale, sizeEnd: 0.05, color: 0xf4f1ff, shape: Shape.Dot, drag: 4 });
    }
    this.shadowFx.add(GroundKind.Disc, e.x, e.z, e.radius * 0.5, e.radius * 0.9, 0.6, 0x000000, { alpha: 0.14 });
    this.music.plink(this.streak);
    if (this.audio.allowHit(3)) V.shh(this.audio, this.audio.now, 0.8);
    this.addHype(e.elite ? 0.12 : 0.0045 + (e.kind === 'mute' ? 0.004 : 0));
    // streak milestones
    const ms = [25, 50, 100, 200, 400, 800, 1600, 3200];
    if (ms.includes(this.streak)) {
      const words = ['NICE', 'ON FIRE', 'CROWD GOES WILD', 'UNSTOPPABLE', 'LEGENDARY', 'GODLIKE', 'TRANSCENDENT', 'THE HUSH WEEPS'];
      const w = words[ms.indexOf(this.streak)]!;
      this.hud.streakCallout(w);
      V.crowdCheer(this.audio, this.audio.now, 0.4 + ms.indexOf(this.streak) * 0.1, 2);
    }
  }

  private addHype(n: number): void {
    const run = this.run!;
    if (this.dropState === 'active' || this.dropState === 'queued') return;
    const silenceBoost = this.boss instanceof TheHush && this.boss.silent ? 3 : 1;
    run.hype = Math.min(1, run.hype + n * run.stats.hypeGain * silenceBoost);
  }

  private collect(pk: Pickup): void {
    const run = this.run!;
    switch (pk.kind) {
      case 'xp': {
        run.xp += pk.value;
        this.pickupChain++;
        this.pickupChainT = 0.5;
        if (this.pickupChain % 2 === 0 || pk.value > 3) this.music.pickup(this.pickupChain);
        let leveled = false;
        while (run.xp >= run.xpToNext) {
          run.xp -= run.xpToNext;
          run.level++;
          run.pendingDrafts++;
          leveled = true;
        }
        if (leveled) this.levelUpFlourish();
        this.glow.emit({ x: this.player.x, y: 1.2, z: this.player.z, life: 0.25, size: 1.6, sizeEnd: 0.2, color: 0x2ee6ff, shape: Shape.Ring, alpha: 0.4 });
        break;
      }
      case 'tip':
        run.tips += Math.round(pk.value * run.stats.tipsMult);
        V.cowbell(this.audio, this.audio.now, 0.18);
        V.bell(this.audio, this.audio.now, 96, 0.4, undefined, 0.2);
        break;
      case 'record':
        run.pendingGold++;
        this.hud.announce('GOLD RECORD', 'a rare pick awaits', '#ffc53d', 1.6);
        this.music.fanfare(false);
        break;
      case 'heart':
        this.heal(25);
        V.bell(this.audio, this.audio.now, 76, 0.7);
        this.hud.toast('+25 HEALTH', '#ff3b5c');
        break;
    }
  }

  private levelUpFlourish(): void {
    const p = this.player;
    this.music.fanfare(false);
    this.announceCooldown = 0.45;
    this.slowMo = 0.45;
    const c = new THREE.Color(0x2ee6ff);
    this.ground.add(GroundKind.Shock, p.x, p.z, 0.5, 7, 0.5, c, { thickness: 0.1 });
    this.glow.burst(p.x, 1.4, p.z, 40, 0x2ee6ff, 12, { vy: 14, life: 0.8, size: 0.35, shape: Shape.Note, gravity: 8 });
    this.flashScreen('rgba(46,230,255,0.25)');
    // knock nearby Hush back so the draft never opens on a death sentence
    this.enemies.hash.query(p.x, p.z, 8, (i) => {
      const e = this.enemies.list[i]!;
      if (!e.alive || e.scripted) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      e.kx += (dx / d) * 22;
      e.kz += (dz / d) * 22;
    });
  }

  private heal(n: number): void {
    const run = this.run;
    if (!run) return;
    const before = run.hp;
    run.hp = Math.min(run.stats.maxHp, run.hp + n);
    if (run.hp - before >= 1 && Math.random() < 0.4)
      this.numbers.spawn(this.player.x, 2.8, this.player.z, run.hp - before, 0x3dffc5, 0.6, '+');
  }

  private contactDamage(): void {
    const p = this.player;
    if (p.invuln > 0 || p.dashT > 0) return;
    this.enemies.hash.query(p.x, p.z, p.radius + 3, (i) => {
      const e = this.enemies.list[i]!;
      if (!e.alive || e.spawnT < 0.6) return;
      const rr = p.radius + e.radius * 0.85;
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < rr * rr) {
        this.hurt(e.dmg * (1 + this.run!.loop * 0.4) * (1 + this.run!.loudness * 0.1), e.x, e.z);
        return true;
      }
    });
  }

  private damperCheck(dt: number): void {
    const p = this.player;
    let inside = false;
    for (const e of this.enemies.list) {
      if (!e.alive || e.kind !== 'damper') continue;
      if (Math.random() < dt * 6)
        this.shadowFx.add(GroundKind.Disc, e.x, e.z, DAMPER_RADIUS, DAMPER_RADIUS, 0.35, 0x000000, { fixed: true, alpha: 0.35 });
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < DAMPER_RADIUS * DAMPER_RADIUS) inside = true;
    }
    const cantorSilence = this.boss instanceof Cantor && this.boss.inSilence(p.x, p.z);
    const hush = this.boss instanceof TheHush && this.boss.silent;
    this.silenced = inside || cantorSilence || hush;
    this.music.hushed = this.silenced;
    this.hud.setMuffled(inside || cantorSilence);
  }

  private godMode = false;
  private readonly pendingIntros: InstrumentId[] = [];
  private overlayOpen = false;

  private hurt(amount: number, fromX: number, fromZ: number): void {
    const p = this.player;
    const run = this.run!;
    if (p.invuln > 0 || p.dashT > 0 || this.state !== 'playing' || this.godMode) return;
    run.hp -= amount;
    p.invuln = 0.9;
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    p.vx += (dx / d) * 14;
    p.vz += (dz / d) * 14;
    this.playerModel.hurt();
    this.muffleHurt = 1;
    this.rig.addTrauma(0.45 * this.save.settings.shake);
    this.stage.aberrationKick = 1;
    this.flashScreen('rgba(255,30,60,0.28)');
    V.hurt(this.audio, this.audio.now);
    this.hitStop = Math.max(this.hitStop, 0.05);
    this.streak = 0;
    if (run.hp <= 0) this.die();
  }

  private die(): void {
    const run = this.run!;
    if (run.pedals.encore > run.revives) {
      run.revives++;
      run.hp = run.stats.maxHp * 0.6;
      this.player.invuln = 3;
      this.hud.announce('ENCORE!', 'the crowd refuses to let you leave', '#ffd36b', 2.6);
      V.crowdCheer(this.audio, this.audio.now, 1.2, 3);
      this.nuke(1e9, 40, new THREE.Color(0xffd36b));
      return;
    }
    this.state = 'dying';
    this.dyingT = 2.4;
    this.muffleTarget = 0.85;
    this.hud.announce('SILENCE', 'the Hush takes the stage', '#9fb8ff', 2.4);
    V.impact(this.audio, this.audio.now, 0.8);
    this.transport.setBpm(this.transport.bpm * 0.5);
  }

  private nuke(dmg: number, r: number, color: THREE.Color): void {
    const p = this.player;
    this.enemies.hash.query(p.x, p.z, r, (i) => {
      const e = this.enemies.list[i]!;
      if (!e.alive) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      if (!e.alive || e.scripted) return;
      this.damage(e, dmg, { color, inst: null, kx: dx, kz: dz, knock: 12 });
    });
  }

  private detonateDrop(): void {
    const run = this.run!;
    const p = this.player;
    this.dropState = 'active';
    run.drops++;
    const color = new THREE.Color(this.venue.palette.accents[0]!);
    const dmg = 90 * (1 + run.level * 0.2) * run.stats.dmgMult * (1 + run.venueIndex * 1.5);
    this.enemies.hash.query(p.x, p.z, 24, (i) => {
      const e = this.enemies.list[i]!;
      if (!e.alive) return;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      this.damage(e, e.scripted ? dmg * 3 : dmg, { color, inst: null, kx: dx, kz: dz, knock: 16 });
    });
    for (let k = 0; k < 3; k++) {
      this.ground.add(GroundKind.Shock, p.x, p.z, 1, 18 + k * 8, 0.6 + k * 0.2, this.venue.palette.accents[k]!, { thickness: 0.05 });
    }
    this.venue.ripple(p.x, p.z, color, 2);
    // a pillar of light where the performer stands
    this.beams.add(p.x, 0, p.z, p.x, 40, p.z, 5, color, 0.9);
    this.beams.add(p.x, 0, p.z, p.x, 40, p.z, 1.8, 0xffffff, 0.7);
    this.ground.add(GroundKind.Disc, p.x, p.z, 2, 9, 0.7, 0xffffff, { alpha: 0.6 });
    this.glow.burst(p.x, 2, p.z, 160, color, 30, { vy: 20, life: 1.2, size: 0.5, shape: Shape.Square, gravity: 14, spin: 10 });
    this.glow.burst(p.x, 2, p.z, 80, 0xffffff, 26, { vy: 10, life: 0.8, size: 0.4, shape: Shape.Spark });
    this.hitStop = 0.14;
    this.rig.addTrauma(0.8 * this.save.settings.shake);
    this.rig.punch(10, 4);
    this.stage.aberrationKick = 1;
    this.stage.bloomKick = 2.5;
    this.flashScreen('rgba(255,255,255,0.55)');
    this.hud.announce('DROP!', `${run.stats.dropBars} BARS · EVERYTHING ×2`, '#ffffff', 1.8, true);
    this.stage.surge = 1;
    this.buildT = 0;
    // confetti cannons from the four corners of the view
    const acc = this.venue.palette.accents;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const ox = p.x + sx * 18;
      const oz = p.z + sz * 11;
      for (let k = 0; k < 45; k++) {
        const spread = (Math.random() - 0.5) * 0.9;
        const dx = -sx * (0.7 + spread) * (14 + Math.random() * 12);
        const dz = -sz * (0.5 - spread * 0.5) * (10 + Math.random() * 10);
        this.dark.emit({
          x: ox,
          y: 1,
          z: oz,
          vx: dx,
          vy: 12 + Math.random() * 10,
          vz: dz,
          life: 2.6 + Math.random(),
          size: 0.4 + Math.random() * 0.3,
          sizeEnd: 0.35,
          color: acc[k % acc.length]!,
          shape: k % 5 === 0 ? Shape.Note : Shape.Square,
          drag: 1.1,
          gravity: 9,
          spin: (Math.random() - 0.5) * 16,
          stretch: k % 5 === 0 ? 1 : 0.5,
        });
      }
    }
    V.crowdCheer(this.audio, this.audio.now, 1.4, 3.5);
    this.pickups.vacuum();
    if (this.boss instanceof TheHush) this.boss.breakSilence(this.bossCtx);
  }

  private flashScreen(color: string): void {
    if (!this.save.settings.flashes) return;
    this.flash.style.background = color;
    this.flash.classList.remove('go');
    void this.flash.offsetWidth;
    this.flash.classList.add('go');
  }

  /* ───────────────────────────── boss ───────────────────────────── */

  private spawnBoss(): void {
    const rim = this.venue.palette.rim;
    this.boss = this.venue.id === 'basement' ? new Feedback(rim) : this.venue.id === 'cathedral' ? new Cantor(rim) : new TheHush(rim);
    const p = this.player;
    let bx = p.x;
    let bz = p.z - 12;
    clampToBounds(this.venue.bounds, bx, bz, 6, this.tmp);
    bx = this.tmp.x;
    bz = this.tmp.z;
    if (Math.hypot(bx - p.x, bz - p.z) < 10) {
      bz = p.z + 14;
      clampToBounds(this.venue.bounds, bx, bz, 6, this.tmp);
      bx = this.tmp.x;
      bz = this.tmp.z;
    }
    this.bossCtx.hpMult = this.director!.hpMult(0) * (1 + this.run!.loudness * 0.2);
    this.boss.spawn(this.bossCtx, bx, bz);
    this.boss.attach(this.world);
    this.music.backing = 'boss';
    // second wind: the crowd roars for the headliner
    const run = this.run!;
    const healed = Math.round(run.stats.maxHp * 0.3);
    run.hp = Math.min(run.stats.maxHp, run.hp + healed);
    this.hud.toast(`THE CROWD ROARS  +${healed} HEALTH`, '#3dffb0');
    this.hud.announce(this.boss.name, this.boss.title, '#' + this.boss.color.toString(16).padStart(6, '0'), 3.5);
    V.roar(this.audio, this.audio.now, 1);
    V.impact(this.audio, this.audio.now + 0.05, 0.9);
    this.rig.addTrauma(0.6 * this.save.settings.shake);
    this.ground.add(GroundKind.Shock, bx, bz, 1, 16, 0.8, this.boss.color, { thickness: 0.06 });
  }

  private onBossDefeated(): void {
    const boss = this.boss!;
    const run = this.run!;
    boss.dead = true;
    const bx = boss.x;
    const bz = boss.z;
    // release the slot: new minions may reuse it, and the boss script must never touch them
    boss.entry = null;
    this.bossDownT = 4;
    this.hud.boss(null);
    const color = new THREE.Color(boss.color);
    // everything on the field dies with the headliner
    for (const e of this.enemies.list) if (e.alive && !e.scripted) this.kill(e, { color, inst: null });
    this.pickups.vacuum(['xp', 'tip', 'record', 'heart']);
    this.hitStop = 0.35;
    this.rig.addTrauma(1);
    this.rig.punch(12, 5);
    this.stage.bloomKick = 3;
    this.flashScreen('rgba(255,255,255,0.7)');
    V.impact(this.audio, this.audio.now, 1.2);
    V.crash(this.audio, this.audio.now + 0.02, 1);
    V.crowdCheer(this.audio, this.audio.now + 0.1, 1.5, 5);
    this.music.fanfare(true);
    for (let k = 0; k < 5; k++) {
      this.schedule(k * 0.25, () => {
        const x = bx + (Math.random() - 0.5) * 8;
        const z = bz + (Math.random() - 0.5) * 8;
        this.glow.burst(x, 2, z, 90, this.venue.palette.accents[k % 4]!, 26, { vy: 22, life: 1.3, size: 0.55, shape: Shape.Square, gravity: 14, spin: 12 });
        this.ground.add(GroundKind.Shock, x, z, 1, 14, 0.7, this.venue.palette.accents[k % 4]!, { thickness: 0.06 });
        V.kick(this.audio, this.audio.now, 1, true);
      });
    }
    this.world.remove(boss.group);
    for (let i = 0; i < 12; i++) this.pickups.spawn('tip', bx, bz, 5, 3);
    run.tips += 40;
    if (run.venueIndex >= 2) {
      this.finale();
      return;
    }
    this.hud.announce(`${VENUE_NAMES[run.venueIndex]} HEADLINED`, 'the crowd is losing its mind', '#ffe14d', 3.6);
  }

  /** The Hush falls: fireworks, a chanting crowd, and a stage lit gold. */
  private finale(): void {
    const p = this.player;
    this.bossDownT = 9;
    this.hud.announce('ENCORE!', 'the silence is broken', '#ffd36b', 5, true);
    const acc = [0xffd36b, 0xff2dd4, 0x2ee6ff, 0xffffff, 0x8cff5a];
    for (let k = 0; k < 26; k++) {
      this.schedule(0.4 + k * 0.28, () => {
        const x = p.x + (Math.random() - 0.5) * 40;
        const z = p.z - 6 - Math.random() * 14;
        const c = acc[k % acc.length]!;
        // rocket
        for (let t = 0; t < 8; t++)
          this.glow.emit({ x, y: 1 + t * 1.6, z, vy: 2, life: 0.35 + t * 0.04, size: 0.4, sizeEnd: 0, color: 0xfff1d0, shape: Shape.Dot });
        // burst
        this.schedule(0.32, () => {
          this.glow.burst(x, 14 + Math.random() * 4, z, 90, c, 18, { vy: 6, life: 1.6, size: 0.45, shape: Shape.Spark, gravity: 6, drag: 1.6 });
          this.glow.emit({ x, y: 15, z, life: 0.4, size: 12, sizeEnd: 16, color: c, shape: Shape.Ring, alpha: 0.6 });
          V.kick(this.audio, this.audio.now, 0.5, true);
          V.crash(this.audio, this.audio.now + 0.02, 0.35);
        });
      });
    }
    // "EN-CORE! EN-CORE!" on the beat
    const beat = this.transport.stepDur * 4;
    const t0 = this.transport.nextDownbeat(this.audio.now);
    const chord = this.music.currentChord;
    for (let i = 0; i < 8; i++) {
      const t = t0 + i * beat * 2;
      V.choir(this.audio, t, [chord.root, chord.root + 7], beat * 0.45, 1.1);
      V.choir(this.audio, t + beat, [chord.root + 3, chord.root + 10], beat * 0.8, 1.2);
      V.clap(this.audio, t, 0.8);
      V.clap(this.audio, t + beat, 0.8);
      V.crowdCheer(this.audio, t, 0.5, 1.2);
    }
    V.crowdCheer(this.audio, this.audio.now, 1.6, 6);
  }

  private afterBoss(): void {
    const run = this.run!;
    if (this.boss) {
      this.boss.dispose();
      this.boss = null;
    }
    if (run.venueIndex >= 2) {
      this.endRun(true);
      return;
    }
    this.openBackstage();
  }

  /* ───────────────────────────── drafts ───────────────────────────── */

  private draftContext(): DraftContext {
    const run = this.run!;
    return {
      pattern: run.pattern,
      pedals: run.pedals,
      grooves: run.grooves,
      bpm: this.transport.bpm,
      unlocked: new Set(this.save.unlocked),
      luck: 0,
    };
  }

  private editorPattern: unknown = null;

  private ensureEditor(): SeqEditor {
    const run = this.run!;
    if (!this.editor || this.editorPattern !== run.pattern) {
      this.editorPattern = run.pattern;
      this.editor = new SeqEditor(
        run.pattern,
        this.icons,
        {
          placed: (ti, step) => this.onEditorPlace(ti, step),
          lifted: () => V.uiClick(this.audio, this.audio.now, -5),
          denied: () => V.uiError(this.audio, this.audio.now),
          fxPlaced: (step, fx) => this.onFxPlaced(step, fx),
        },
        () => run.grooves,
        () => run.discovered,
      );
    }
    return this.editor;
  }

  private onEditorPlace(ti: number, step: number): void {
    const run = this.run!;
    if (run.pattern.tracks[ti]) V.uiClick(this.audio, this.audio.now, 3 + (step % 4));
    this.checkGroovesLive();
    this.updateDraftDone();
  }

  private onFxPlaced(_step: number, _fx: string): void {
    V.uiClick(this.audio, this.audio.now, 7);
    this.music.fanfare(false);
    this.editor?.setMode({ kind: 'free' });
    if (this.draftPending) this.draftPending.placing = null;
    if (this.shopPlacing) this.shopPlacing = false;
    this.checkGroovesLive();
    this.updateDraftDone();
    this.renderShop();
  }

  private checkGroovesLive(): void {
    const run = this.run!;
    const fresh = run.refresh();
    for (const g of fresh) this.celebrateGroove(g);
    this.editor?.refresh();
    this.band.sync(run.pattern.tracks.map((t) => ({ inst: t.inst, evolved: t.evolved })));
    this.updateTempo();
  }

  private celebrateGroove(g: GrooveId): void {
    const d = GROOVES[g];
    this.newGroovesThisRun++;
    const firstEver = !this.save.grooves.includes(g);
    if (firstEver) {
      this.save.grooves.push(g);
      writeSave(this.save);
    }
    this.queueStamp(() => {
      this.music.fanfare(true);
      V.scratch(this.audio, this.audio.now, 1, 0.28);
      this.hud.stamp(d.genre, d.name, d.bonus, d.color, firstEver);
      if (this.state === 'playing') this.hitStop = Math.max(this.hitStop, 0.35);
    });
  }

  private readonly stampQueue: (() => void)[] = [];
  private stampCooldown = 0;

  /** Big centre moments never stack: stamps wait for drops and for each other. */
  private queueStamp(fn: () => void): void {
    this.stampQueue.push(fn);
  }

  private processStamps(dt: number): void {
    this.stampCooldown -= dt;
    if (this.stampCooldown > 0 || !this.stampQueue.length) return;
    if (this.dropState === 'queued' || this.dropState === 'active') return;
    this.stampQueue.shift()!();
    this.stampCooldown = 2.4;
  }

  private processAnnouncements(dt: number): void {
    this.processStamps(dt);
    this.announceCooldown -= dt;
    if (this.announceCooldown > 0 || !this.announceQueue.length) return;
    const a = this.announceQueue.shift()!;
    this.hud.announce(a.title, a.sub, a.color, 2.6);
    this.hud.setVisible(true);
    this.announceCooldown = 1.2;
  }

  private openDraft(gold: boolean): void {
    const run = this.run!;
    if (gold) run.pendingGold--;
    else run.pendingDrafts--;
    const ctx = this.draftContext();
    const offers = gold ? drawGoldOffers(ctx, run.draftRng) : drawOffers(ctx, run.draftRng);
    this.draftPending = { gold, offers, pickedIndex: -1, placing: null };
    this.state = 'draft';
    this.muffleTarget = 0.3;
    this.input.clearLatched();
    const editor = this.ensureEditor();
    editor.setMode({ kind: 'free' });
    editor.refresh();
    this.draftUi.attachEditor(editor.el);
    this.draftUi.open({
      title: gold ? 'GOLD RECORD' : `LEVEL ${run.level}`,
      sub: gold ? 'Rare material. Choose wisely.' : 'New material for the set. Pick one, then tweak the machine.',
      gold,
      offers: offers.map((card) => ({ card, view: describeCard(card, run.pattern, this.icons, run.pedals) })),
      rerolls: run.rerolls,
      pick: (i) => this.draftPick(i),
      reroll: () => this.draftReroll(),
      done: () => this.closeDraft(),
      hover: () => V.uiHover(this.audio, this.audio.now, 2),
    });
    V.whoosh(this.audio, this.audio.now, 0.8, true, 0.3);
    if (gold) this.music.fanfare(true);
  }

  private draftKeys(): void {
    if (!this.draftPending) return;
    if (this.autopilot) {
      if (!this.draftUi.hasPicked) {
        const offers = this.draftPending.offers;
        const score = (c: Card): number =>
          c.kind === 'evolve' ? 100 : c.kind === 'instrument' ? 8 : c.kind === 'notes' ? 7 : c.kind === 'level' ? 6 : c.kind === 'fx' ? 5 : 4;
        let best = 0;
        offers.forEach((c, i) => {
          if (score(c) + Math.random() > score(offers[best]!) + Math.random()) best = i;
        });
        this.draftUi.pick(best);
      } else this.draftUi.finish();
      return;
    }
    if (this.input.take('pick1')) this.draftUi.pick(0);
    if (this.input.take('pick2')) this.draftUi.pick(1);
    if (this.input.take('pick3')) this.draftUi.pick(2);
    if (this.input.take('reroll')) this.draftReroll();
  }

  private draftReroll(): void {
    const run = this.run!;
    const dp = this.draftPending;
    if (!dp || run.rerolls <= 0 || this.draftUi.hasPicked) return;
    run.rerolls--;
    const ctx = this.draftContext();
    dp.offers = dp.gold ? drawGoldOffers(ctx, run.draftRng) : drawOffers(ctx, run.draftRng);
    this.draftUi.refreshOffers(
      dp.offers.map((card) => ({ card, view: describeCard(card, run.pattern, this.icons, run.pedals) })),
      run.rerolls,
    );
    V.scratch(this.audio, this.audio.now, 0.8, 0.2);
  }

  private draftPick(i: number): void {
    const dp = this.draftPending;
    if (!dp) return;
    const card = dp.offers[i]!;
    dp.pickedIndex = i;
    const r = cardRarity(card);
    V.uiClick(this.audio, this.audio.now, 5);
    if (r !== 'common') this.music.fanfare(r === 'legendary' || r === 'epic');
    dp.placing = this.applyCard(card);
    this.updateDraftDone();
  }

  /** Apply a card to the run. Returns the kind of placement the player still has to do. */
  private applyCard(card: Card): 'notes' | 'fx' | null {
    const run = this.run!;
    const ed = this.ensureEditor();
    let placing: 'notes' | 'fx' | null = null;
    switch (card.kind) {
      case 'instrument':
        run.pattern.addTrack(card.inst);
        this.pendingIntros.push(card.inst);
        ed.rebuild();
        ed.focusTrack = run.pattern.tracks.length - 1;
        break;
      case 'notes':
        run.pattern.addSpare(card.inst, card.n);
        ed.focusTrack = run.pattern.tracks.findIndex((t) => t.inst === card.inst);
        placing = 'notes';
        break;
      case 'level':
        run.pattern.levelUp(card.inst);
        break;
      case 'fx':
        ed.setMode({ kind: 'fx', fx: card.fx });
        placing = 'fx';
        break;
      case 'pedal':
        run.pedals[card.pedal]++;
        if (card.pedal === 'roadie') this.schedule(0, () => this.heal(40));
        if (card.pedal === 'clicktrack') this.hud.toast(`TEMPO UP: ${this.transport.bpm + 8} BPM`, '#2ee6ff');
        this.hud.toast(`${PEDALS[card.pedal].name.toUpperCase()} ON THE BOARD`, '#fff');
        break;
      case 'evolve': {
        const t = run.pattern.track(card.inst);
        if (t) {
          t.evolved = true;
          run.pattern.version++;
          run.evolvedNow.add(card.inst);
          const evo = INSTRUMENTS[card.inst].evolution;
          const nm = INSTRUMENTS[card.inst].name.toUpperCase();
          this.queueStamp(() => {
            this.hud.stamp(evo.name, `${nm} EVOLVED`, evo.blurb, '#ffd36b', true);
            V.gong(this.audio, this.audio.now, 0.7);
            this.music.fanfare(true);
          });
          if (!this.save.evolutions.includes(card.inst)) {
            this.save.evolutions.push(card.inst);
            writeSave(this.save);
          }
        }
        break;
      }
      case 'heal':
        run.hp = Math.min(run.stats.maxHp, run.hp + run.stats.maxHp * 0.5);
        break;
      case 'tips':
        run.tips += card.amount;
        break;
    }
    this.checkGroovesLive();
    ed.refresh();
    return placing;
  }

  private updateDraftDone(): void {
    const run = this.run!;
    const dp = this.draftPending;
    if (!dp || dp.pickedIndex < 0) return;
    const spare = run.pattern.tracks.reduce((a, t) => a + t.spare, 0);
    if (dp.placing === 'fx') this.draftUi.setDoneState(true, 'AUTO-PLACE FX & GO ▸');
    else if (spare > 0) this.draftUi.setDoneState(true, `AUTO-PLACE ${spare} & GO ▸`);
    else this.draftUi.setDoneState(true, 'BACK TO THE SHOW ▸');
  }

  private autoPlaceAll(): void {
    const run = this.run!;
    const ed = this.editor;
    if (this.draftPending?.placing === 'fx' || (ed && ed.el.classList.contains('fx-mode'))) {
      const card = this.draftPending ? this.draftPending.offers[this.draftPending.pickedIndex] : undefined;
      const fx = card && card.kind === 'fx' ? card.fx : this.shopFx;
      if (fx) {
        // best step: most tracks, prefer on-beat
        let best = 0;
        let bestScore = -1;
        for (let s = 0; s < 16; s++) {
          if (!run.pattern.canApplyFx(s, fx)) continue;
          const score = run.pattern.tracksOnStep(s) * 2 + (s % 4 === 0 ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = s;
          }
        }
        run.pattern.applyFx(best, fx);
      }
      ed?.setMode({ kind: 'free' });
    }
    run.pattern.tracks.forEach((_, i) => run.pattern.autoPlace(i));
    this.checkGroovesLive();
  }

  private closeDraft(): void {
    const run = this.run!;
    this.autoPlaceAll();
    this.draftUi.close();
    this.draftPending = null;
    run.refresh();
    this.band.sync(run.pattern.tracks.map((t) => ({ inst: t.inst, evolved: t.evolved })));
    this.updateTempo();
    this.music.looperChance = run.stats.looperChance;
    this.player.invuln = Math.max(this.player.invuln, 0.8);
    this.input.clearLatched();
    V.whoosh(this.audio, this.audio.now, 0.7, false, 0.25);
    if (run.pendingDrafts > 0 || run.pendingGold > 0) {
      this.openDraft(run.pendingGold > 0);
      return;
    }
    this.state = 'playing';
    this.muffleTarget = 0;
    this.playIntros();
  }

  /** New band members drop in from the rafters under a spotlight and soundcheck. */
  private playIntros(): void {
    while (this.pendingIntros.length) {
      const inst = this.pendingIntros.shift()!;
      this.band.introduce(inst);
      const color = INSTRUMENTS[inst].color;
      this.schedule(0.05, () => {
        const o = this.band.origin(inst, this.player.x, this.player.z);
        this.beams.add(o.x, 0, o.z, o.x, 30, o.z, 2.6, color, 1.1, 0.8);
        this.ground.add(GroundKind.Shock, o.x, o.z, 0.5, 4, 0.6, color, { thickness: 0.08 });
        this.glow.burst(o.x, 2, o.z, 30, color, 8, { vy: 6, life: 0.8, size: 0.35, shape: Shape.Spark });
      });
      const t = this.transport.upcoming;
      const chord = this.music.currentChord;
      const beat = this.transport.stepDur * 2;
      const voice = (k: number): void => {
        const at = t + k * beat;
        switch (inst) {
          case 'bass':
            V.bass(this.audio, at, chord.root - 24 + (k ? 7 : 0), beat * 0.9, 0.8, 0);
            break;
          case 'lead':
            V.lead(this.audio, at, chord.root + 12 + (k ? 7 : 0), 0.9);
            break;
          case 'pad':
            V.pad(this.audio, at, [chord.root, chord.root + 7], beat * 2, 0.8, 0.5);
            break;
          case 'organ':
            V.organ(this.audio, at, [chord.root, chord.root + 7], beat, 0.8);
            break;
          case 'gong':
            if (k === 0) V.gong(this.audio, at, 0.8);
            break;
          case 'hat':
            V.hat(this.audio, at, 0.8, k === 1);
            break;
          case 'clap':
            V.clap(this.audio, at, 0.9);
            break;
          case 'crash':
            if (k === 1) V.crash(this.audio, at, 0.8);
            break;
          case 'tom':
            V.tom(this.audio, at, 0.9, k ? -5 : 0);
            break;
          case 'cowbell':
            V.cowbell(this.audio, at, 0.9);
            break;
          case 'scratch':
            V.scratch(this.audio, at, 0.9, 0.15);
            break;
          default:
            V.kick(this.audio, at, 0.8);
        }
      };
      voice(0);
      voice(1);
      this.hud.toast(`${INSTRUMENTS[inst].name.toUpperCase()} JOINS THE BAND — "ONE, TWO"`, INSTRUMENTS[inst].css);
    }
  }

  /* ───────────────────────────── backstage ───────────────────────────── */

  private shopPlacing = false;
  private shopFx: 'accent' | 'ratchet' | 'echo' | null = null;

  private openBackstage(): void {
    const run = this.run!;
    this.state = 'backstage';
    this.hud.setVisible(false);
    this.muffleTarget = 0.35;
    this.shop = { items: [], rerollPrice: 15, healPrice: 30 };
    this.stockShop();
    const ed = this.ensureEditor();
    ed.setMode({ kind: 'free' });
    ed.refresh();
    this.backstage.attachEditor(ed.el);
    const next = VENUE_NAMES[run.venueIndex + 1] ?? 'THE MAINSTAGE';
    this.backstage.open(
      'BACKSTAGE',
      `${VENUE_NAMES[run.venueIndex]} headlined. Spend your tips, rework the machine — next up is a bigger room.`,
      `WALK OUT TO ${next} ▸`,
    );
    this.renderShop();
    V.crowdCheer(this.audio, this.audio.now, 0.3, 2);
  }

  private stockShop(): void {
    const run = this.run!;
    const ctx = { ...this.draftContext(), luck: 0.3 };
    const cards = [...drawOffers(ctx, run.lootRng, 3), ...drawGoldOffers(ctx, run.lootRng, 1)];
    const price = (c: Card): number => {
      const r = cardRarity(c);
      return (r === 'common' ? 25 : r === 'rare' ? 45 : r === 'epic' ? 80 : 140) * (1 + run.venueIndex * 0.5);
    };
    this.shop!.items = cards.map((card) => ({
      card,
      view: describeCard(card, run.pattern, this.icons, run.pedals),
      price: Math.round(price(card)),
      sold: false,
    }));
  }

  private renderShop(): void {
    if (!this.shop || !this.run) return;
    const run = this.run;
    this.backstage.render(this.shop.items, run.tips, this.shop.healPrice, this.shop.rerollPrice, run.hp >= run.stats.maxHp, this.shopPlacing);
  }

  private shopBuy(i: number): void {
    const run = this.run!;
    const it = this.shop?.items[i];
    if (!it || it.sold || run.tips < it.price) return;
    run.tips -= it.price;
    it.sold = true;
    V.cowbell(this.audio, this.audio.now, 0.6);
    const placing = this.applyCard(it.card);
    if (placing === 'fx' && it.card.kind === 'fx') {
      this.shopPlacing = true;
      this.shopFx = it.card.fx;
    }
    // refresh descriptions (levels changed)
    for (const s of this.shop!.items) s.view = describeCard(s.card, run.pattern, this.icons, run.pedals);
    this.renderShop();
  }

  private shopHeal(): void {
    const run = this.run!;
    if (!this.shop || run.tips < this.shop.healPrice) return;
    run.tips -= this.shop.healPrice;
    run.hp = run.stats.maxHp;
    this.shop.healPrice += 20;
    V.bell(this.audio, this.audio.now, 76, 0.8);
    this.renderShop();
  }

  private shopReroll(): void {
    const run = this.run!;
    if (!this.shop || run.tips < this.shop.rerollPrice) return;
    run.tips -= this.shop.rerollPrice;
    this.shop.rerollPrice += 10;
    this.stockShop();
    V.scratch(this.audio, this.audio.now, 0.8, 0.2);
    this.renderShop();
  }

  private leaveBackstage(): void {
    const run = this.run!;
    if (this.shopPlacing) this.autoPlaceAll();
    this.shopPlacing = false;
    run.pattern.tracks.forEach((_, i) => run.pattern.autoPlace(i));
    run.refresh();
    this.backstage.close();
    this.editor?.setMode({ kind: 'free' });
    this.beginVenue(run.venueIndex + 1);
    this.schedule(1.5, () => this.playIntros());
  }

  /* ───────────────────────────── visuals ───────────────────────────── */

  private updateOutro(dt: number, beatPhase: number): void {
    this.updateVisuals(dt, dt, beatPhase);
  }

  private updateVisuals(dt: number, rawDt: number, beatPhase: number): void {
    const p = this.player;
    const run = this.run;
    const drop = this.dropState === 'active';
    this.energy = damp(this.energy, clamp(this.enemies.aliveCount / 140, 0.15, 1) * (drop ? 1.3 : 1), 2, rawDt);

    this.stage.camera.getWorldDirection(this.camDir).negate();
    this.enemies.setCameraDir(this.camDir);
    this.enemies.render(this.time, beatPhase);
    if (drop && dt > 0) {
      // paper confetti rains for the whole drop
      const acc = this.venue.palette.accents;
      for (let k = 0; k < 10; k++) {
        this.dark.emit({
          x: p.x + (Math.random() - 0.5) * 44,
          y: 16 + Math.random() * 4,
          z: p.z + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 2,
          vy: -6 - Math.random() * 4,
          vz: (Math.random() - 0.5) * 2,
          life: 3,
          size: 0.35 + Math.random() * 0.25,
          sizeEnd: 0.3,
          color: acc[Math.floor(Math.random() * acc.length)]!,
          shape: Shape.Square,
          drag: 0.6,
          gravity: 1.5,
          spin: (Math.random() - 0.5) * 14,
          stretch: 0.55,
        });
      }
    }
    if (dt > 0) {
      for (const e of this.enemies.list) {
        if (!e.alive || !e.elite || e.scripted) continue;
        const hy = e.kind === 'bouncer' ? 3.2 * e.scale : 2.1 * e.scale;
        this.glow.emit({ x: e.x, y: hy, z: e.z, life: rawDt * 1.05, size: 1.4, color: 0xffc53d, shape: Shape.Ring, alpha: 0.9 });
        this.glow.emit({ x: e.x, y: hy, z: e.z, life: rawDt * 1.05, size: 0.6, color: 0xffe9a8, shape: Shape.Spark, alpha: 0.9, rot: this.time * 2 });
      }
    }
    this.pickups.render(this.time);
    this.band.update(rawDt, this.time, p.x, p.z);
    this.playerModel.update(rawDt, this.time, p.x, p.z, p.facing, p.tilt, beatPhase, this.spectrum, p.dashT > 0, p.invuln > 0);

    this.venue.update({
      dt: rawDt,
      time: this.time,
      beatPhase,
      barPhase: this.transport.barPhase(this.audio.audibleTime()),
      energy: this.energy,
      drop: drop && this.save.settings.flashes,
      spectrum: this.spectrum,
      playerX: p.x,
      playerZ: p.z,
      bossActive: !!this.boss,
      build: this.buildT,
      camQuat: this.stage.camera.quaternion,
    });
    this.setVenueBar();

    this.glow.update(dt || rawDt * 0.02);
    this.dark.update(dt || rawDt * 0.02);
    this.ground.update(dt || rawDt * 0.02);
    this.shadowFx.update(dt || rawDt * 0.02);
    this.beams.update(dt || rawDt * 0.02);
    this.numbers.update(dt || rawDt * 0.02);

    // camera: follow with look-ahead toward aim, breathe with the beat
    // keep the camera over the room: it may lag the player near the walls instead of showing the void
    const b = this.venue.bounds;
    const cx = b.kind === 'rect' ? clamp(p.x, -b.hx + 13, b.hx - 13) : p.x * 0.8;
    const cz = b.kind === 'rect' ? clamp(p.z, -b.hz + 7, b.hz - 3) : p.z * 0.8;
    this.rig.target.set(cx, 0, cz);
    this.venue.occlude?.(p.x, p.z);
    const boss = this.boss && this.boss.entry?.alive ? this.boss : null;
    if (boss) {
      // frame the duel: lean toward the headliner and pull back a little
      const bx = clamp((boss.x - p.x) * 0.35, -9, 9);
      const bz = clamp((boss.z - p.z) * 0.35, -7, 7);
      this.rig.setLookAhead(bx + p.aimX, bz + p.aimZ);
    } else {
      this.rig.setLookAhead(p.aimX * 2.2, p.aimZ * 1.6);
    }
    const baseDist = 31 + (run ? Math.min(6, run.pattern.tracks.length * 0.4) : 0) + (boss ? 5 : 0) - this.buildT * 7;
    this.rig.distance = damp(this.rig.distance, baseDist, this.rig.distance > baseDist + 8 ? 1.6 : 1.2, rawDt);
    this.rig.pitch = 0.98;
    this.rig.yaw = 0;
    const kick = Math.pow(1 - beatPhase, 6);
    if (kick > 0.9 && drop) this.rig.punch(1.2);
    this.rig.update(rawDt, this.save.settings.shake);
    this.stage.baseBloom = 1.05 + (drop ? 0.5 : 0) + kick * 0.15;
    if (drop && this.save.settings.flashes) this.stage.aberrationKick = Math.max(this.stage.aberrationKick, kick * 0.35);
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  private schedule(delay: number, fn: () => void): void {
    this.scheduled.push({ t: delay, fn });
  }

  private makeWeaponCtx(): WeaponCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    return {
      get run() {
        return game.run!;
      },
      enemies: this.enemies,
      projectiles: this.projectiles,
      glow: this.glow,
      ground: this.ground,
      beams: this.beams,
      get px() {
        return game.player.x;
      },
      get pz() {
        return game.player.z;
      },
      get aimX() {
        return game.player.aimX;
      },
      get aimZ() {
        return game.player.aimZ;
      },
      manualAim: false,
      origin: (inst) => this.band.origin(inst, this.player.x, this.player.z),
      damage: (e, a, o) => this.damage(e, a, o),
      heal: (n) => this.heal(n),
      shake: (n) => this.rig.addTrauma(n * this.save.settings.shake),
      ripple: (x, z, c, s) => this.venue.ripple(x, z, c, s),
      schedule: (d, fn) => this.schedule(d, fn),
    };
  }

  private makeBossCtx(): BossCtx {
    return {
      enemies: this.enemies,
      glow: this.glow,
      ground: this.ground,
      beams: this.beams,
      px: 0,
      pz: 0,
      playerInvuln: false,
      spawnMinion: (kind, x, z) => {
        clampToBounds(this.venue.bounds, x, z, 1, this.tmp);
        const e = this.enemies.spawn(kind, this.tmp.x, this.tmp.z, this.director?.hpMult(this.run?.setTime ?? 0) ?? 1);
        if (e) this.spawnPuff(e);
      },
      shoot: (x, z, vx, vz, r) => this.enemyShoot(x, z, vx, vz, r),
      hurtPlayer: (d, x, z) => this.hurt(d * (1 + (this.run?.loop ?? 0) * 0.4), x, z),
      shake: (n) => this.rig.addTrauma(n * this.save.settings.shake),
      roar: () => V.roar(this.audio, this.audio.now, 0.9),
      setSilence: (on) => {
        this.hud.announce(on ? 'THE SILENCE' : 'SOUND RETURNS', on ? 'build hype and DROP to break it' : 'the Hush is staggered — hit it!', on ? '#8060ff' : '#ffffff', 3);
        if (on) this.run!.hype = Math.max(this.run!.hype, 0.4);
      },
      hpMult: 1,
      camQuat: new THREE.Quaternion(),
    };
  }

  private exposeDebug(): void {
    // compile-time constant: the whole body is dead code (and stripped) in production builds
    if (!import.meta.env.DEV) return;
    const dbg = {
      game: this,
      levelUp: (n = 1) => {
        if (!this.run) return;
        this.run.level += n;
        this.run.pendingDrafts += n;
      },
      gold: () => this.run && this.run.pendingGold++,
      hype: () => this.run && (this.run.hype = 1),
      skip: (t = 999) => this.run && (this.run.setTime = t),
      venue: (i: number) => this.run && this.beginVenue(i),
      god: () => (this.godMode = true),
      tips: (n = 500) => this.run && (this.run.tips += n),
      give: (inst: InstrumentId) => this.run && (this.run.pattern.addTrack(inst), this.checkGroovesLive()),
      state: () => this.state,
      bot: (on = true) => (this.autopilot = on),
      botLog: () => this.autoLog,
      runInfo: () =>
        this.run && {
          level: this.run.level,
          hp: this.run.hp,
          kills: this.run.kills,
          venue: this.run.venueIndex,
          tracks: this.run.pattern.serialize(),
          grooves: [...this.run.grooves.active],
          pedals: Object.entries(this.run.pedals).filter(([, v]) => v > 0),
          damage: this.run.damage,
          bestHit: this.run.bestHit,
          setTime: this.run.setTime,
          bpm: this.transport.bpm,
        },
      prof: () => prof.report(),
      mix: () => import('../dev/mix').then((m) => m.mixReport()),
      density: () => import('../dev/mix').then((m) => m.densityReport()),
      profReset: () => prof.reset(),
      backstage: () => this.run && this.openBackstage(),
      results: (won = false) => this.run && this.endRun(won),
      spawn: (kind: import('../render/hush').HushKind, n = 10) => this.run && this.release(kind, n, false, false),
      fans: (n = 1000) => {
        this.save.fans += n;
        writeSave(this.save);
      },
    };
    (window as unknown as { __encore: typeof dbg }).__encore = dbg;
  }
}
