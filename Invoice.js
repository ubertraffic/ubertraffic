// Invoice.js — the client-facing invoice for a completed job, built to the ATO tax-invoice rules.
// Auto-generated from the settled job + the real Stripe charge (nothing typed). Model: the worker is
// the SELLER, SiteCall facilitates. Seller ABN/licence come from a party-gated definer lookup (0070).
//
// ATO fields covered: "Tax invoice" heading (GST-registered only), seller name + ABN, date, item
// descriptions (qty + price), GST as a separate line; buyer identity/ABN when total ≥ $1,000; NSW
// contractor licence line for licensed trades. Not GST-registered → a plain "Invoice", no GST.
//
// Props: visible, request (settled request w/ request_items[].assignments[].operator), payment, onClose.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Share, Platform } from 'react-native';
import { C, R, S, T, shadowSm } from './theme';
import { getMyIdentity } from './accountService';
import { getInvoiceSellers } from './paymentsService';

// DORMANT until the invoice AUTHOR/structure is confirmed with the accountant (RCTI needs both parties
// GST-registered; worker-issued needs the worker registered; SiteCall-issued is different again). The
// generator stays off the user surface so nobody is shown a document whose structure may change — but
// field capture (ABN, GST status, licence, ABR business name) continues so we're ready to switch it on.
export const INVOICE_ENABLED = false;

const d$ = (dollars) => `$${(Number(dollars) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtAbn = (abn) => {
  const s = String(abn || '').replace(/\D/g, '');
  return /^\d{11}$/.test(s) ? s.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : (abn || '');
};

export default function Invoice({ visible, request, payment, onClose }) {
  const [biz, setBiz] = useState(null);        // buyer (the client — their own name/ABN)
  const [sellers, setSellers] = useState([]);  // worker seller details (name/abn/licence/gst)
  useEffect(() => {
    if (!visible || !request) return;
    getMyIdentity().then(setBiz).catch(() => setBiz({}));
    getInvoiceSellers(request.id).then(setSellers).catch(() => setSellers([]));
  }, [visible, request?.id]);

  if (!request) return null;
  const r = request;
  const items = r.request_items || [];
  const hours = Number(r.duration_hours) || 4;

  const lines = items.map((it) => {
    const qty = Number(it.qty) || 1;
    const rate = Number(it.rate ?? it.rate_offered) || 0;
    const isTask = it.price_mode === 'job';
    const amount = isTask ? rate * qty : rate * hours * qty;
    return {
      label: it.type || 'Labour',
      detail: isTask ? `${qty} × job @ ${d$(rate)}` : `${qty} worker${qty > 1 ? 's' : ''} × ${hours}h @ ${d$(rate)}/hr`,
      amount,
    };
  });

  const labourOnly = lines.reduce((n, l) => n + l.amount, 0);
  const travel = (Number(payment?.travel_cents) || 0) / 100;
  const tip = (Number(payment?.tip_cents) || 0) / 100;
  const computed = labourOnly + travel + tip;
  const paidTotal = payment?.amount_cents != null ? Number(payment.amount_cents) / 100 : computed;

  const gstApplies = (sellers || []).some((sll) => sll.gst_registered);
  const gst = gstApplies ? paidTotal / 11 : 0;         // GST-inclusive: 1/11th of the (inclusive) total
  const exGst = paidTotal - gst;
  const bigInvoice = paidTotal >= 1000;                 // ≥ $1,000 → buyer identity/ABN required

  const invNo = `SC-INV-${String(r.id || '').replace(/-/g, '').slice(-8).toUpperCase()}`;
  const issued = payment?.updated_at || payment?.created_at || r.approved_at || r.created_at;
  const issuedStr = issued ? new Date(issued).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const billTo = biz?.company_name || biz?.legal_name || 'Client';
  const billAbn = biz?.company_abn ? fmtAbn(biz.company_abn) : null;

  const travelTip = [travel ? { label: 'Travel allowance', amount: travel } : null, tip ? { label: 'Tip', amount: tip } : null].filter(Boolean);

  async function share() {
    const sellerLines = (sellers || []).map((sll) =>
      `${sll.name || 'Contractor'}  ABN ${fmtAbn(sll.abn)}${sll.licence ? `  · NSW Lic ${sll.licence}` : ''}`);
    const body = [
      gstApplies ? 'TAX INVOICE' : 'INVOICE',
      ...sellerLines,
      `Invoice No: ${invNo}`,
      issuedStr && `Date issued: ${issuedStr}`,
      `Bill to: ${billTo}${bigInvoice && billAbn ? `  ABN ${billAbn}` : ''}`,
      '',
      ...lines.map((l) => `${l.label} — ${l.detail}: ${d$(l.amount)}`),
      ...travelTip.map((l) => `${l.label}: ${d$(l.amount)}`),
      gstApplies ? `Subtotal (excl. GST): ${d$(exGst)}` : null,
      gstApplies ? `GST (10%): ${d$(gst)}` : null,
      `Total${gstApplies ? ' (incl. GST)' : ''}: ${d$(paidTotal)}  — PAID`,
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
            <Text style={s.docType}>{gstApplies ? 'TAX INVOICE' : 'INVOICE'}</Text>
            <View style={s.paidPill}><Text style={s.paidPillT}>PAID</Text></View>
          </View>

          <ScrollView style={{ maxHeight: 470 }} showsVerticalScrollIndicator={false}>
            {/* SELLER (worker) — name, ABN, NSW licence */}
            {(sellers || []).length ? (sellers || []).map((sll, i) => (
              <View key={sll.operator_id || i} style={i > 0 ? { marginTop: 8 } : null}>
                <Text style={s.sellerName}>{sll.name || 'Contractor'}</Text>
                <Text style={s.sellerLine}>ABN {fmtAbn(sll.abn) || '—'}</Text>
                {sll.licence ? <Text style={s.sellerLine}>NSW contractor licence {sll.licence}</Text> : null}
              </View>
            )) : (
              <Text style={s.sellerLine}>Contractor details loading…</Text>
            )}

            <View style={s.metaGrid}>
              <View style={s.metaCell}><Text style={s.metaLabel}>Invoice no.</Text><Text style={s.metaVal}>{invNo}</Text></View>
              <View style={s.metaCell}><Text style={s.metaLabel}>Date issued</Text><Text style={s.metaVal}>{issuedStr || '—'}</Text></View>
            </View>
            <View style={[s.metaGrid, { marginTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.metaLabel}>Bill to</Text>
                <Text style={s.metaVal}>{billTo}{bigInvoice && billAbn ? `  ·  ABN ${billAbn}` : ''}</Text>
                {bigInvoice && !billAbn ? <Text style={s.warn}>Add your business ABN in Account for invoices over $1,000.</Text> : null}
              </View>
            </View>
            {r.address_text ? <Text style={[s.metaLabel, { marginTop: 8 }]}>Site: <Text style={s.siteVal}>{r.address_text}</Text></Text> : null}

            <View style={s.divider} />
            <View style={s.lineHead}><Text style={s.lineHeadT}>Description</Text><Text style={s.lineHeadT}>Amount</Text></View>
            {lines.map((l, i) => (
              <View key={i} style={s.lineRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={s.lineLabel}>{l.label}</Text>
                  <Text style={s.lineDetail}>{l.detail}</Text>
                </View>
                <Text style={s.lineAmt}>{d$(l.amount)}</Text>
              </View>
            ))}
            {travelTip.map((l, i) => (
              <View key={`e${i}`} style={s.lineRow}><Text style={[s.lineLabel, { flex: 1 }]}>{l.label}</Text><Text style={s.lineAmt}>{d$(l.amount)}</Text></View>
            ))}

            <View style={s.divider} />
            {gstApplies ? (
              <>
                <View style={s.totRow}><Text style={s.totLabel}>Subtotal (excl. GST)</Text><Text style={s.totVal}>{d$(exGst)}</Text></View>
                <View style={s.totRow}><Text style={s.totLabel}>GST (10%)</Text><Text style={s.totVal}>{d$(gst)}</Text></View>
              </>
            ) : null}
            <View style={[s.totRow, { marginTop: 6 }]}>
              <Text style={s.grandLabel}>Total{gstApplies ? ' (incl. GST)' : ''}</Text>
              <Text style={s.grandVal}>{d$(paidTotal)}</Text>
            </View>

            <Text style={s.footer}>
              Facilitated by SiteCall. Paid in full securely via Stripe — no payment due.
              {(sellers || []).length > 1 ? ' This job engaged multiple contractors.' : ''}
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
  grip: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  docType: { fontSize: 20, fontWeight: '900', color: C.ink, letterSpacing: 0.5 },
  paidPill: { backgroundColor: C.greenSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  paidPillT: { color: C.green, fontWeight: '900', fontSize: 11, letterSpacing: 0.6 },
  sellerName: { fontSize: 16, fontWeight: '900', color: C.ink },
  sellerLine: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  metaGrid: { flexDirection: 'row', gap: 16, marginTop: 14 },
  metaCell: { flex: 1 },
  metaLabel: { fontSize: 10.5, fontWeight: '800', color: C.mute2, letterSpacing: 0.4, textTransform: 'uppercase' },
  metaVal: { fontSize: 13.5, fontWeight: '700', color: C.ink, marginTop: 3, lineHeight: 18 },
  siteVal: { fontSize: 12.5, fontWeight: '600', color: C.mute, textTransform: 'none', letterSpacing: 0 },
  warn: { fontSize: 11, color: C.amber, fontWeight: '700', marginTop: 3 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 15 },
  lineHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  lineHeadT: { fontSize: 10.5, fontWeight: '800', color: C.mute2, letterSpacing: 0.4, textTransform: 'uppercase' },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 11 },
  lineLabel: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  lineDetail: { fontSize: 12.5, color: C.mute, marginTop: 2 },
  lineAmt: { fontSize: 14.5, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  totLabel: { fontSize: 13, color: C.mute, fontWeight: '600' },
  totVal: { fontSize: 13, color: C.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  grandLabel: { fontSize: 16, fontWeight: '900', color: C.ink },
  grandVal: { fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  footer: { fontSize: 11.5, color: C.mute2, marginTop: 18, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  shareBtn: { flex: 1, backgroundColor: C.indigo, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  shareT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  doneBtn: { flex: 1, backgroundColor: C.panel, borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  doneT: { color: C.ink, fontWeight: '800', fontSize: 15 },
});
