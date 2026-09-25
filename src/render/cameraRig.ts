import * as THREE from 'three';
import { damp } from '../core/math';

/**
 * Follow camera with trauma-based shake, FOV punches and aim look-ahead.
 * Trauma decays linearly; shake magnitude is trauma² (Squirrel Eiserloh's GDC talk).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  readonly focus = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector3();
  distance = 30;
  pitch = 0.98; // radians from horizontal
  yaw = 0;
  baseFov = 42;
  private trauma = 0;
  private fovPunch = 0;
  private zoomPunch = 0;
  private t = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punch(fov: number, zoom = 0): void {
    this.fovPunch = Math.max(this.fovPunch, fov);
    this.zoomPunch = Math.min(this.zoomPunch, -Math.abs(zoom));
  }

  setLookAhead(x: number, z: number): void {
    this.lookAhead.set(x, 0, z);
  }

  snap(): void {
    this.focus.copy(this.target);
    this.update(0, 1);
  }

  update(dt: number, shakeScale = 1): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.fovPunch = damp(this.fovPunch, 0, 9, dt);
    this.zoomPunch = damp(this.zoomPunch, 0, 6, dt);

    const goalX = this.target.x + this.lookAhead.x;
    const goalZ = this.target.z + this.lookAhead.z;
    this.focus.x = damp(this.focus.x, goalX, 5.5, dt);
    this.focus.z = damp(this.focus.z, goalZ, 5.5, dt);
    this.focus.y = this.target.y;

    const d = this.distance + this.zoomPunch;
    const cx = this.focus.x + Math.sin(this.yaw) * Math.cos(this.pitch) * d;
    const cz = this.focus.z + Math.cos(this.yaw) * Math.cos(this.pitch) * d;
    const cy = this.focus.y + Math.sin(this.pitch) * d;

    const s = this.trauma * this.trauma * shakeScale;
    const n = (k: number): number =>
      Math.sin(this.t * 37.1 + k * 12.3) * 0.6 + Math.sin(this.t * 71.7 + k * 4.1) * 0.4;
    this.camera.position.set(cx + n(1) * s * 1.6, cy + n(2) * s * 1.2, cz + n(3) * s * 1.6);
    this.camera.lookAt(this.focus.x, this.focus.y, this.focus.z);
    this.camera.rotateZ(n(4) * s * 0.05);
    const fov = this.baseFov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Screen pixel → point on the ground plane (y = 0). */
  groundFromScreen(px: number, py: number, out: THREE.Vector3): THREE.Vector3 | null {
    this.ndc.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  /** World → CSS pixel coordinates; returns false when behind the camera. */
  toScreen(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    this.tmp.set(x, y, z).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * window.innerHeight;
    return this.tmp.z < 1;
  }
}
