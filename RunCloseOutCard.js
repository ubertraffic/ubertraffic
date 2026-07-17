// RunCloseOutCard.js — completion for a RUN (errand-tier delivery/pickup).
//
// Separate from the labour CloseOutCard (never touches it). Captures the two
// things a run needs, on rails that already exist:
//   1. RECEIPT rides the materials-claim rail: the receipt photo uploads to
//      storage (ReceiptCapture -> path) and, with the amount, goes to
//      submitMaterialClaim() — the same rail the MaterialsClaim UI uses. The
//      client approves it later (existing ReviewApprove). Actual payout is the
//      deferred money pass.
//   2. DROP-OFF photo satisfies the completion gate: captured as a normal
//      kind='completion' proof photo (ProofPhoto), which is what compliance_ready
//      already requires for the errand tier — so no compliance RPC changes.
//
// The "message the client BEFORE you buy" path is surfaced prominently up top:
// the #1 failure mode of an open run is buying the wrong thing.
//
// onComplete() = the caller's existing checkout (run only once cleared).

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { C, S, R, T } from './theme';
import { submitMaterialClaim } from './completionService';
import ProofPhoto from './ProofPhoto';
import ReceiptCapture from './ReceiptCapture';

export default function RunCloseOutCard({ assignmentId, list, cap, pickup, onComplete, onCancel, onMessage }) {
  const [dropDone, setDropDone] = useState(false);       // drop-off (completion) photo captured
  const [receiptPath, setReceiptPath] = useState(null);  // stored receipt image path
  const [amount, setAmount] = useState('');
  const [claimDone, setClaimDone] = useState(false);     // materials claim already submitted
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const amt = parseFloat(amount) || 0;
  const ready = dropDone && !!receiptPath && amt > 0;

  async function finish() {
    if (!ready) { setErr('Add the drop-off photo, the receipt, and the amount first.'); return; }
    setBusy(true); setErr('');
    try {
      // Receipt -> materials-claim rail (once). note carries the ordered list for context.
      if (!claimDone) {
        await submitMaterialClaim(assignmentId, amt, receiptPath, list || null);
        setClaimDone(true);
      }
      await onComplete();   // existing checkout — the drop-off photo satisfies the gate
    } catch (e) {
      setErr((e && e.message) || 'Couldn’t finish the run. Try again.');
      setBusy(false);
    }
  }

  return (
    <View style={cardStyle}>
      <Text style={[T.eyebrow, { marginBottom: 4 }]}>Finish the run</Text>
      {/* Compact reminder of what/where — the full brief (with "message before you buy") now
          lives up front on the run, so this sheet stays focused on proof. */}
      {(list || pickup) ? (
        <View style={listBox}>
          {list ? (<><Text style={[T.small, { color: C.mute, marginBottom: 4, fontWeight: '700' }]}>What was ordered</Text>
          <Text style={[T.body]}>{list}</Text></>) : null}
          {pickup ? <Text style={[T.small, { color: C.mute, marginTop: list ? 6 : 0 }]}>From: {pickup}</Text> : null}
          {cap > 0 ? <Text style={[T.small, { color: C.mute, marginTop: 6 }]}>Spend cap: up to ${cap}</Text> : null}
        </View>
      ) : null}

      {/* Drop-off photo -> satisfies the completion gate */}
      <View style={{ marginTop: S.md }}>
        <ProofPhoto assignmentId={assignmentId} kind="completion" label="Drop-off photo" onCaptured={() => setDropDone(true)} />
      </View>

      {/* Receipt -> materials-claim rail */}
      <View style={{ marginTop: S.md }}>
        <ReceiptCapture assignmentId={assignmentId} onCaptured={(p) => setReceiptPath(p)} />
      </View>
      <View style={{ marginTop: S.md }}>
        <Text style={[T.body, { fontWeight: '700', marginBottom: 6 }]}>Amount spent</Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink }}
          value={amount}
          onChangeText={setAmount}
          placeholder="$0"
          placeholderTextColor={C.mute2}
          keyboardType="decimal-pad"
        />
        {cap > 0 && amt > cap ? <Text style={[T.small, { color: C.amber, marginTop: 6 }]}>Over the ${cap} cap — the client will need to approve the extra.</Text> : null}
      </View>

      {err ? <Text style={[T.small, { color: C.red, marginTop: S.sm }]}>{err}</Text> : null}

      <TouchableOpacity
        onPress={finish}
        disabled={!ready || busy}
        activeOpacity={0.9}
        style={{ backgroundColor: (!ready || busy) ? C.mute : C.green, borderRadius: R.md, paddingVertical: 15, alignItems: 'center', marginTop: S.md }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{busy ? 'Finishing…' : ready ? 'Mark done' : 'Add photo, receipt & amount'}</Text>
      </TouchableOpacity>

      {onCancel ? (
        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: 'center' }}>
          <Text style={[T.small, { color: C.mute }]}>Not yet</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const cardStyle = { backgroundColor: '#fff', borderRadius: R.lg, padding: S.lg, margin: S.md };
const listBox = { borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md };
const msgBtn = { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 13, paddingHorizontal: 14, marginTop: S.sm };
