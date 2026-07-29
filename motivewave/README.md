# GEXLab V3 MotiveWave study

`gexlab/GexLabLevels.java` is the MotiveWave counterpart to the Pine indicator in
[`src/lib/indicator.ts`](../src/lib/indicator.ts). Both read the **same bridge payload**, so a payload
copied once from the app works in either platform.

Unlike Pine, MotiveWave studies are compiled Java — you cannot paste the source into the app. Compile
it and drop the classes into the extensions folder.

## Build

You need a JDK (17 or newer) and `mwave_sdk.jar` from the MotiveWave sample project
(<https://motivewave.com/sdk.htm> → `MotiveWave_Studies.zip`, jar is under `lib/`).

```sh
javac -classpath /path/to/mwave_sdk.jar -d build motivewave/gexlab/GexLabLevels.java
```

## Install

Copy the compiled output into the MotiveWave extensions directory, preserving the `gexlab/` package
folder. MotiveWave scans this directory recursively for `.jar` and `.class` files at startup.

| OS | Path |
| --- | --- |
| Windows | `C:\Users\<username>\MotiveWave Extensions` |
| macOS | `~/MotiveWave Extensions` (hidden) |
| Linux | `~/MotiveWave Extensions` |

```sh
cp -r build/gexlab "$HOME/MotiveWave Extensions/"
```

Restart MotiveWave. The study appears under **Study → GEXLab → GEXLab V3 Futures Levels**.

## Use

1. In GEXLab, pick your expiries and level groups, then **Copy bridge**.
2. Add the study to an NQ or ES chart and paste the payload into **GEXLab bridge**.
3. Set the conversion mode (see below).

The study reads section 1 of the payload on an NQ chart and section 0 on an ES chart, matching the
Pine indicator. On any other instrument it draws nothing and says so in the status label.

### Conversion modes

| Mode | Behavior |
| --- | --- |
| Use payload as-is | Correct when the app exported futures-ready prices (payload starts with `F#`). |
| Index spot to live ratio | Enter the index spot shown in the app; levels scale by `chart close / index spot`. |
| Manual ratio | Multiply native index levels by a fixed ratio. Separate NQ and ES inputs. |
| Manual basis | Add a fixed basis to native index levels. Separate NQ and ES inputs. |

An `F#` payload ignores the conversion mode entirely, since the app already converted the prices.

### Difference from the Pine indicator

Pine's "Observed ratio" and "Additive basis" modes sample the cash index through
`request.security`. The MotiveWave SDK's `DataContext` exposes other bar sizes but not other
instruments, so those two live-sampled modes have no equivalent here. **Index spot to live ratio** is
the closest substitute: it takes the index spot as a number and keeps the futures side live.

## Editing

`GexLabLevels.java` is the source of truth. After changing it, regenerate the module the app's
**Copy MotiveWave** button serves:

```sh
npm run sync:motivewave
```

`npm test` fails if `src/lib/motivewave-indicator.ts` drifts from the Java file.
