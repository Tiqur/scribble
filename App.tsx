/**
 * Settings panel — shown via PluginManager.showPluginView() (from the note
 * app's config-button and the sidebar button). Fine-tunes the zig-zag
 * detection thresholds on-device, with live feedback of the most recent
 * classifications.
 *
 * E-ink friendly: white background, black text, no sliders (continuous drags
 * don't redraw well) — steppers with large touch targets instead. All
 * interaction is discrete.
 *
 * Settings are in-memory only (the SDK has no file-write API): they apply to
 * the next stroke, survive while the plugin stays loaded, and reset on process
 * restart. The "Copy into constants.ts" snippet is the make-it-permanent path —
 * long-press the snippet text to select/copy, paste it over ZIGZAG_CONFIG, and
 * rebuild.
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PluginManager } from 'sn-plugin-lib';
import { BUILD_TAG } from './src/constants';
import {
  copyConstantsSnippet,
  getRecentDecisions,
  getZigzagConfig,
  resetZigzagConfig,
  setZigzagConfig,
  type ZigzagConfig,
} from './src/config';

interface FieldSpec {
  key: keyof ZigzagConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  isInt: boolean;
}

const FIELDS: FieldSpec[] = [
  { key: 'MIN_ANGLE_DEG', label: 'Turn angle °', min: 90, max: 170, step: 5, isInt: true },
  { key: 'MIN_REVERSALS', label: 'Min reversals', min: 2, max: 12, step: 1, isInt: true },
  { key: 'STEP_DIST_PCT', label: 'Angle window %', min: 1, max: 12, step: 0.5, isInt: false },
  { key: 'EPSILON_PCT', label: 'RDP tolerance %', min: 0.2, max: 3, step: 0.1, isInt: false },
  { key: 'HOOK_MARGIN_PCT', label: 'Hook margin %', min: 0, max: 15, step: 1, isInt: false },
];

const round2 = (v: number): number => Math.round(v * 100) / 100;

function fmtValue(f: FieldSpec, v: number): string {
  return f.isInt ? String(v) : v.toFixed(1);
}

function StepperRow({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const clamp = (v: number) => Math.min(field.max, Math.max(field.min, round2(v)));
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{field.label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepBtn, value <= field.min && styles.stepBtnDisabled]}
          onPress={() => onChange(clamp(value - field.step))}
          disabled={value <= field.min}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepValue}>{fmtValue(field, value)}</Text>
        <TouchableOpacity
          style={[styles.stepBtn, value >= field.max && styles.stepBtnDisabled]}
          onPress={() => onChange(clamp(value + field.step))}
          disabled={value >= field.max}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function App(): React.JSX.Element {
  const [cfg, setCfg] = useState<ZigzagConfig>(() => getZigzagConfig());
  const [decisions, setDecisions] = useState(() => getRecentDecisions());

  // The panel's feedback updates even while the user is only looking (new
  // strokes are classified by the PEN_UP handler while the view is open).
  useEffect(() => {
    const timer = setInterval(() => setDecisions(getRecentDecisions()), 1500);
    return () => clearInterval(timer);
  }, []);

  const patch = (key: keyof ZigzagConfig, value: number) => {
    setZigzagConfig({ [key]: value });
    setCfg(getZigzagConfig());
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Scribble settings</Text>
        <Text style={styles.tag}>{BUILD_TAG}</Text>
      </View>

      {FIELDS.map(f => (
        <StepperRow
          key={f.key}
          field={f}
          value={cfg[f.key] as number}
          onChange={v => patch(f.key, v)}
        />
      ))}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            resetZigzagConfig();
            setCfg(getZigzagConfig());
          }}
        >
          <Text style={styles.buttonText}>Reset to defaults</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            try {
              PluginManager.closePluginView();
            } catch (e) {
              console.error('closePluginView failed:', e);
            }
          }}
        >
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Last classifications</Text>
      <View style={styles.monoBox}>
        <Text style={styles.mono}>
          {decisions.length === 0
            ? 'no strokes yet — draw on the page, then reopen'
            : decisions
                .slice()
                .reverse()
                .map(d => d.line)
                .join('\n')}
        </Text>
      </View>

      <Text style={styles.section}>Copy into constants.ts (make permanent)</Text>
      <View style={styles.monoBox}>
        <Text selectable style={styles.mono}>
          {copyConstantsSnippet(cfg)}
        </Text>
      </View>

      <Text style={styles.footnote}>
        Settings apply live to the next stroke. They are kept in memory: a
        device restart resets them — use the snippet above to bake them in.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  content: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#000000' },
  tag: { fontSize: 13, color: '#000000' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#d0d0d0',
    paddingVertical: 10,
  },
  rowLabel: { flex: 1, fontSize: 16, color: '#000000', marginRight: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 56,
    height: 48,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  stepBtnDisabled: { borderColor: '#a0a0a0' },
  stepBtnText: { fontSize: 22, fontWeight: '700', color: '#000000' },
  stepValue: {
    width: 88,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
    height: 52,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#000000' },
  section: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#000000',
  },
  monoBox: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#ffffff',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#000000',
  },
  footnote: {
    marginTop: 14,
    fontSize: 12,
    color: '#555555',
  },
});

export default App;
