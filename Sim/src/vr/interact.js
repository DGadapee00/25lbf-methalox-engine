/**
 * Pointing. Desktop: a click on the canvas. Headset: the controller target ray
 * on select, or a pinch (index fingertip, along the wrist-to-index direction).
 * Snap turn and "go to" move the stand around the head. The headset is not
 * driven through the room.
 *
 * Snap sign +1 rotates the stand counterclockwise about world up. The scene
 * slides to the user's left, which is a snap turn to the right.
 */
import * as THREE from 'three';
import { HANDLE_M, READ_MODULE_M, RIG_BELOW_EYE_M, RIG_FORWARD_M, SNAP_TURN_RAD, TUBE_OD_M } from './scale.js';
import { buttonAt } from './panel.js';

const UP = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _offset = new THREE.Vector3();

const PINCH_M = READ_MODULE_M / 2;
const STICK_ON = 0.7;
const STICK_OFF = 0.3;

function actionOf(obj) {
  let o = obj;
  while (o) {
    if (o.userData?.panel) return { panel: true };
    if (o.userData?.act) return o.userData.act;
    o = o.parent;
  }
  return null;
}

export function placeInFront(stand, anchorLocal, headPos, headQuat) {
  const forward = _dir.set(0, 0, -1).applyQuaternion(headQuat);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
  else forward.normalize();
  const towardUser = _a.copy(forward).negate();
  const x = _b.crossVectors(UP, towardUser);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  else x.normalize();
  const y = _offset.crossVectors(towardUser, x).normalize();
  stand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, towardUser));
  const anchor = new THREE.Vector3(...anchorLocal).applyQuaternion(stand.quaternion);
  stand.position.set(
    headPos.x + forward.x * RIG_FORWARD_M - anchor.x,
    headPos.y - RIG_BELOW_EYE_M - anchor.y,
    headPos.z + forward.z * RIG_FORWARD_M - anchor.z,
  );
}

export function snapAround(stand, headPos, sign) {
  const angle = sign * SNAP_TURN_RAD;
  _offset.copy(stand.position).sub(headPos);
  _offset.applyAxisAngle(UP, angle);
  stand.position.copy(headPos).add(_offset);
  stand.rotateOnWorldAxis(UP, angle);
}

export function createInteraction({ renderer, scene, camera, canvas, view, session, layout }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = layout.span + RIG_FORWARD_M * 2;
  const pinched = { left: false, right: false, none: false };
  let stickLatched = false;
  const ndc = new THREE.Vector2();

  const reach = layout.span + RIG_FORWARD_M;
  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(TUBE_OD_M / 4, TUBE_OD_M / 4, reach, 6),
      new THREE.MeshBasicMaterial({ color: 0x58c4dd }),
    );
    // Cylinder lies on Y. The controller points down its local −Z.
    ray.rotation.x = Math.PI / 2;
    ray.position.z = -reach / 2;
    controller.add(ray);
    scene.add(controller);
    controller.addEventListener('select', () => {
      _origin.setFromMatrixPosition(controller.matrixWorld);
      _dir.set(0, 0, -1).transformDirection(controller.matrixWorld);
      fire(_origin, _dir);
    });
  }

  function fire(origin, direction) {
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(view.pickables, true);
    if (!hits.length) return false;
    const hit = hits[0];
    const act = actionOf(hit.object);
    if (!act) return false;
    if (act.panel) {
      const btn = hit.uv ? buttonAt(hit.uv.x, hit.uv.y, view.model) : null;
      if (btn) session.dispatch(btn.act);
      return !!btn;
    }
    session.dispatch(act);
    return true;
  }

  function head() {
    if (renderer.xr.isPresenting) {
      const cam = renderer.xr.getCamera();
      return { position: cam.position, quaternion: cam.quaternion };
    }
    return camera;
  }

  function consumeMoves() {
    const h = head();
    if (session.state.pendingFocus) {
      const station = session.state.pendingFocus;
      session.state.pendingFocus = null;
      const anchor = layout.stations[station];
      if (anchor) {
        placeInFront(view.root, anchor, h.position, h.quaternion);
        if (renderer.xr.isPresenting) view.setFloorLocal(-view.root.position.y);
      }
    }
    if (session.state.pendingSnap) {
      const sign = session.state.pendingSnap;
      session.state.pendingSnap = null;
      snapAround(view.root, h.position, sign);
      if (renderer.xr.isPresenting) view.setFloorLocal(-view.root.position.y);
    }
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (renderer.xr.isPresenting) return;
    if (ev.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    fire(raycaster.ray.origin, raycaster.ray.direction);
  });

  function poseVector(space, frame, ref, target) {
    const pose = frame.getPose(space, ref);
    if (!pose) return false;
    const p = pose.transform.position;
    target.set(p.x, p.y, p.z);
    return true;
  }

  function pollHands(frame) {
    const xr = renderer.xr.getSession();
    const ref = renderer.xr.getReferenceSpace();
    if (!xr || !frame || !ref) return;
    for (const src of xr.inputSources) {
      const hand = src.hand;
      if (hand) {
        const index = hand.get('index-finger-tip');
        const thumb = hand.get('thumb-tip');
        const wrist = hand.get('wrist');
        const key = src.handedness || 'none';
        if (index && thumb && wrist && poseVector(index, frame, ref, _origin) && poseVector(thumb, frame, ref, _dir) && poseVector(wrist, frame, ref, _wrist)) {
          const gap = _origin.distanceTo(_dir);
          const now = gap < PINCH_M;
          if (now && !pinched[key]) {
            _dir.copy(_origin).sub(_wrist);
            if (_dir.lengthSq() > 1e-8) {
              _dir.normalize();
              fire(_origin, _dir);
            }
          }
          pinched[key] = now;
        }
      }
      if (src.handedness === 'right' && src.gamepad && src.gamepad.axes.length) {
        const axes = src.gamepad.axes;
        const x = axes.length > 2 ? axes[2] : axes[0];
        if (!stickLatched && Math.abs(x) > STICK_ON) {
          stickLatched = true;
          session.dispatch({ type: 'snap', sign: x > 0 ? 1 : -1 });
        } else if (Math.abs(x) < STICK_OFF) stickLatched = false;
      }
    }
  }

  return {
    update(frame) {
      consumeMoves();
      pollHands(frame);
    },
    /** Test hook: a ray from in front of a tagged part, along world −Z. */
    pickTag(tag) {
      const obj = view.byTag[tag];
      if (!obj) return false;
      obj.getWorldPosition(_origin);
      _origin.z += HANDLE_M * 8;
      _dir.set(0, 0, -1);
      return fire(_origin, _dir);
    },
    fire,
  };
}
