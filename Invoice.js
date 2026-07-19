// Invoice.js — the client-facing invoice/receipt for a completed job. Auto-generated from the settled
// job (nothing typed by hand), shown after payment and shareable. The GST/seller labelling is kept as
// a light config (GST off by default) so the exact tax-invoice wording can be switched on once the
// accounting structure is confirmed — the numbers and layout don't change.
//
// Props: visible, request (a settled request with request_items[].assignments[].operator), payment
// (from getPaymentForRequest — for the authoritative charged total + tip/travel + paid date), onClose.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Share, Platform } from 'react-native';
import { C, R, S, T, shadowSm } from './theme';
import { getMyIdentity } from './accountService';

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d$ = (dollars) => `$${(Number(dollars) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Invoice({ visible, request, payment, onClose }) {
  const [biz, setBiz] = useState(null);   // the client's own name/company for the "Bill to" block
  useEffect(() => { if (visible) getMyIdentity().then(setBiz).catch(() => setBiz({})); }, [visible]);

  if (!request) return null;
  const r = request;
  const items = r.request_items || [];
  const hours = Number(r.duration_hours) || 4;

  // Line items straight from the job — labour billed rate x hours x qty, tasks billed rate x qty.
  const lines = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const rate = Number(it.rate ?? it.rate_offered) || 0;
    const isTask = it.price_mode === 'job';
    const amount = isTask ? rate * qty : rate * hours * qty;
    return {
      label: it.type || 'Labour',
      detail: isTask ? `${qty} × job @ ${d$(rate)}` : `${qty} × ${hours}h @ ${d$(rate)}/hr`,
      amount,
    };
  });
  const doneAssigns = items.flatMap((it) => (it.assignments || []).filter((a) => ['complete', 'approved'].includes(a.status)));
  const workers = [...new Set(doneAssigns.map((a) => a.operator?.full_name).filter(Boolean))];
  // GST only when a worker on the job is GST-registered (most aren't → no GST line at all). Prices are
  // GST-inclusive, so we break out the 10% already inside the labour rather than adding anything on top.
  const gstApplies = doneAssigns.some((a) => a.operator?.gst_registered);

  const labourOnly = lines.reduce((n, l) => n + l.amount, 0);
  const travel = (Number(payment?.travel_cents) || 0) / 100;
  const tip = (Number(payment?.tip_cents) || 0) / 100;
  const lineSubtotal = labourOnly + travel + tip;
  // The Stripe charge is the source of truth for what was actually paid; fall back to the computed sum.
  const paidTotal = payment?.amount_cents != null ? Number(payment.amount_cents) / 100 : lineSubtotal;
  const gst = gstApplies ? labourOnly / 11 : 0;   // GST-inclusive: 1/11th of the labour

  const invNo = `SC-INV-${String(r.id || '').replace(/-/g, '').slice(-8).toUpperCase()}`;
  const issued = payment?.updated_at || payment?.created_at || r.approved_at || r.created_at;
  const issuedStr = issued ? new Date(issued).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const billTo = biz?.company_name || biz?.legal_name || 'Client';

  async function share() {
    const body = [
      `INVOICE ${invNo}`,
      issuedStr && `Issued ${issuedStr}`,
      `Bill to: ${billTo}`,
      workers.length ? `Work by: ${workers.join(', ')} (via SiteCall)` : null,
      r.address_text ? `Site: ${r.address_text}` : null,
      '',
      ...lines.map((l) => `${l.label} — ${l.detail}: ${d$(l.amount)}`),
      travel ? `Travel allowance: ${d$(travel)}` : null,
      tip ? `Tip: ${d$(tip)}` : null,
      gstApplies ? `Incl. GST: ${d$(gst)}` : null,
      `TOTAL PAID: ${d$(paidTotal)}`,
      '',
      'Facilitated by SiteCall. Paid securely via Stripe.',
    ].filter(Boolean).join('\n');
    try { await Share.share({ message: body }); } catch (_) {}
  }

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grip} />
          <View style={s.head}>
            <View>
              <Text style={s.brand}>SiteCall</Text>
              <Text style={s.brandSub}>{gstApplies ? 'Tax invoice' : 'Invoice'} · facilitated marketplace</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <View style={s.paidPill}><Text style={s.paidPillT}>PAID</Text></View>
              <Text style={s.invNo}>{invNo}</Text>
            </View>
          </View>

          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            <View style={s.metaRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.metaLabel}>Bill to</Text>
                <Text style={s.metaVal}>{billTo}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.metaLabel}>Issued</Text>
                <Text style={s.metaVal}>{issuedStr || '—'}</Text>
              </View>
            </View>
            {workers.length ? (
              <View style={[s.metaRow, { marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.metaLabel}>Work by</Text>
                  <Text style={s.metaVal}>{workers.join(', ')}</Text>
                </View>
                {r.address_text ? (
                  <View style={{ flex: 1 }}>
                    <Text style={s.metaLabel}>Site</Text>
                    <Text style={s.metaVal} numberOfLines={2}>{r.address_text}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={s.divider} />
            {lines.map((l, i) => (
              <View key={i} style={s.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.lineLabel}>{l.label}</Text>
                  <Text style={s.lineDetail}>{l.detail}</Text>
                </View>
                <Text style={s.lineAmt}>{d$(l.amount)}</Text>
              </View>
            ))}
            {travel ? <View style={s.lineRow}><Text style={[s.lineLabel, { flex: 1 }]}>Travel allowance</Text><Text style={s.lineAmt}>{d$(travel)}</Text></View> : null}
            {tip ? <View style={s.lineRow}><Text style={[s.lineLabel, { flex: 1 }]}>Tip</Text><Text style={s.lineAmt}>{d$(tip)}</Text></View> : null}

            <View style={s.divider} />
            {gstApplies ? (
              <View style={s.totRow}><Text style={s.totLabel}>Includes GST (10%)</Text><Text style={s.totVal}>{d$(gst)}</Text></View>
            ) : null}
            <View style={[s.totRow, { marginTop: 4 }]}>
              <Text style={s.grandLabel}>Total paid</Text>
              <Text style={s.grandVal}>{d$(paidTotal)}</Text>
            </View>

            <Text style={s.footer}>
              Facilitated by SiteCall. Paid securely via Stripe.{gstApplies ? ' Includes GST as shown.' : ''}
            </Text>
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity style={s.shareBtn} onPress={share} activeOpacity={0.9}><Text style={s.shareT}>Share invoice</Text></TouchableOpacity>
            <TouchableOpacity style={s.doneBtn} onPress={onClose} activeOpacity={0.9}><Text style={s.doneT}>Done</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(12,12,20,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 32 },
  grip: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, alignSelf: 'center', marginBottom: 16 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  brand: { fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  brandSub: { fontSize: 12, color: C.mute, fontWeight: '600', marginTop: 1 },
  paidPill: { backgroundColor: C.greenSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  paidPillT: { color: C.green, fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },
  invNo: { fontSize: 12, color: C.mute, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', gap: 16 },
  metaLabel: { fontSize: 10.5, fontWeight: '800', color: C.mute2, letterSpacing: 0.4, textTransform: 'uppercase' },
  metaVal: { fontSize: 14, fontWeight: '700', color: C.ink, marginTop: 3, lineHeight: 19 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 16 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  lineLabel: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  lineDetail: { fontSize: 12.5, color: C.mute, marginTop: 2 },
  lineAmt: { fontSize: 14.5, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totLabel: { fontSize: 13, color: C.mute, fontWeight: '600' },
  totVal: { fontSize: 13, color: C.mute, fontWeight: '700', fontVariant: ['tabular-nums'] },
  grandLabel: { fontSize: 16, fontWeight: '900', color: C.ink },
  grandVal: { fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  footer: { fontSize: 11.5, color: C.mute2, marginTop: 18, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  shareBtn: { flex: 1, backgroundColor: C.indigo, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  shareT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  doneBtn: { flex: 1, backgroundColor: C.panel, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  doneT: { color: C.ink, fontWeight: '800', fontSize: 15 },
});
