# Protocols and axis conventions

Notes from the milestone-2 spike: what was confirmed from sources, and what still needs a live
test with a phone and VNyan. Items marked **UNVERIFIED** are guesses encoded in the code. Each one
can be corrected from Settings → Axis flips without a rebuild.

## Output mode decision

**Chosen: impersonate the VTube Studio iPhone app (`output.mode = "vts"`).**

- VNyan supports the VTS iPhone tracker natively and keeps its own ARKit layer: head position
  drives body lean, and its smoothing applies.
- marmalade (a VTS-protocol emulator) documents using `127.0.0.1` as the phone IP for VNyan on the
  same PC. Its emulator binds UDP 21412 and replies to the port listed in the request. The bridge
  does the same, so VNyan should accept a loopback phone.
- It avoids the UDP 49983 clash. The bridge, not VNyan, receives from iFacialMocap.

A loopback integration test (`packages/bridge/src/pipeline/loopback.test.ts`) exercises this path
end to end: fake iFacialMocap phone → bridge → fake VTS client.

**Still to confirm live:** with VNyan pointed at `127.0.0.1` / "VTube Studio", the avatar tracks
the same as when VNyan is connected straight to the phone.

VMC (`output.mode = "vmc"`) exists as an experimental fallback. It sends blendshapes and the Head
bone only, with no body lean.

## iFacialMocap (input)

Source: <https://www.ifacialmocap.com/for-developer/> and the THA3 / UnityIFM parsers.

- **Handshake:** the PC sends
  `iFacialMocap_sahuasouryya9218sauhuiayeta91555dy3719|sendDataVersion=v2` over UDP to phone:49983.
  The bridge re-sends it whenever nothing has arrived for 2 s.
- **Data:** UDP to PC:49983.
- **Packet format:** items are separated by `|`.
  - Blendshapes are `name&value` (v2) or `name-value` (v1). Values are integers 0–100.
  - Head: `=head#rx,ry,rz,tx,ty,tz`.
  - Eyes: `rightEye#x,y,z` and `leftEye#x,y,z`.
- **Names:** ARKit names with `_L` / `_R` suffixes, e.g. `eyeBlink_L` → `eyeBlinkLeft`.
- **Units:** rotation is degrees. Position units are undocumented. The sample `tz ≈ −0.66` looks
  like metres.
- **Face lost:** iFacialMocap has no flag for this. The bridge treats 20 identical head fields in a
  row as "face lost".
- **UNVERIFIED axis mapping:** canonical = (yaw `ry`, pitch `−rx`, roll `−rz`), position
  (`−tx`, `ty`, `−tz`).

## VTube Studio iPhone (output, and optional input)

Source: <https://github.com/DenchiSoft/VTubeStudioBlendshapeUDPReceiverTest>, marmalade, and
facetrack-d.

- **Request:** sent to phone:21412:
  `{"messageType":"iOSTrackingDataRequest","time":2.5,"sentBy":"App","ports":[11125]}`.
  - `time` is 0.5–10 s.
  - Clients re-send it about once a second.
  - The bridge also accepts `sendForSeconds`.
- **Response:** JSON sent to the requester's IP on every listed port:
  `{Timestamp, Hotkey, FaceFound, Rotation{x,y,z}, Position{x,y,z}, EyeLeft, EyeRight, BlendShapes:[{k,v}]}`.
  - Blendshape keys are PascalCase ARKit names (`EyeBlinkLeft`), with values 0–1.
- **Rotation:** degrees, with `x` = pitch, `y` = yaw, `z` = roll. The signs are **UNVERIFIED**.
- **Position:** **UNVERIFIED** centimetres. Android emulators send cm, and `output.positionScale`
  multiplies on top. The axis signs are **UNVERIFIED** too.
- **Which port VNyan puts in `ports`:** not known. The bridge reads it from each request.

## VNyan WebSocket triggers

Source: VNyan docs, "How-To" wiki.

- Enable it under Settings → Misc → WebSockets.
- **URL:** `ws://localhost:<port>/vnyan`. 8000 is the documented example.
- **Message:** plain text. A **WebSocket Command** node whose Message field matches exactly will
  fire.

## Canonical frames (bridge-internal)

- **Phone frame:**
  - x = right as the user sees the screen
  - y = up
  - z = out of the screen toward the user
  - Units are metres.
- **User frame:**
  - x = the user's left
  - y = up
  - z = forward, toward the monitor
- **Euler angles:** H = Ry(yaw)·Rx(pitch)·Rz(roll), in degrees. For a head facing the phone:
  - +yaw turns toward the user's left
  - +pitch looks up
  - +roll tilts the top of the head toward the user's left

## Live verification checklist

With the identity placement (`default`), check each axis:

1. Turn your head left. The avatar should turn its own left. If not, flip `output.flip.yaw`; if the
   raw numbers in the UI are also wrong, flip `source.flip.yaw` as well.
2. Look up. Fix with `pitch`.
3. Tilt your head toward your left shoulder. Fix with `roll`.
4. Lean forward. The avatar should lean forward. Fix with `posZ`.
5. Lean left. Fix with `posX`.
6. Rise up. Fix with `posY`.

Then calibrate with the phone about 30° to one side. In the Live view, a forward lean should draw
a straight vertical line in the corrected trail. If it is still diagonal, or the correction makes
it worse, the source position and rotation frames disagree. Revisit `source.flip`.
