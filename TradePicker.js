// TradePicker.js — category → search → select. Self-contained.
// Replaces the hardcoded GEAR/CREW/TASK chips with the real taxonomy.
// Props:
//   onPick(trade)  — called with the chosen trade row { id, name, kind, category_id }
//   onCancel()     — optional, back out
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { loadTaxonomy, tradesInCategory, searchTrades } from './taxonomyService';
import { C, MONO, S, R, T, shadowSm } from './theme';
import Icon from './Icon';

const KIND_LABEL = { plant: 'Plant', crew: 'Crew', task: 'Task' };
const KIND_COLOR = { plant: C.indigo, crew: C.green, task: C.amber };

export default function TradePicker({ onPick, onCancel }) {
  const [tax, setTax] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [cat, setCat] = useState(null);     // selected category id
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    loadTaxonomy()
      .then((t) => { if (alive) setTax(t); })
      .catch((e) => { if (alive) { setLoadErr(e); setTax({ categories: [], trades: [] }); } });
    return () => { alive = false; };
  }, []);

  const searching = q.trim().length > 0;
  const results = tax && searching ? searchTrades(tax, q) : [];
  const inCat = tax && cat ? tradesInCategory(tax, cat) : [];

  const TradeRow = useCallback(({ t }) => (
    <TouchableOpacity style={styles.tradeRow} onPress={() => onPick(t)} activeOpacity={0.8}>
      <Icon name={t.kind === 'plant' ? 'gear' : t.kind === 'task' ? 'task' : 'crew'} size={18} color={C.ink} strokeWidth={1.9} />
      <Text style={styles.tradeName}>{t.name}</Text>
      <View style={[styles.kindTag, { backgroundColor: (KIND_COLOR[t.kind] || C.mute) + '18' }]}>
        <Text style={[styles.kindText, { color: KIND_COLOR[t.kind] || C.mute }]}>{KIND_LABEL[t.kind] || t.kind}</Text>
      </View>
    </TouchableOpacity>
  ), [onPick]);

  if (!tax) return <View style={styles.loading}><ActivityIndicator color={C.indigo} /></View>;

  return (
    <View style={styles.wrap}>
      {/* search bar — always available */}
      <View style={styles.searchBar}>
        <Icon name="search" size={18} color={C.mute2} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search any trade or role…"
          placeholderTextColor={C.mute2}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searching ? (
          <TouchableOpacity onPress={() => setQ('')}><Icon name="close" size={16} color={C.mute} /></TouchableOpacity>
        ) : null}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
        {searching ? (
          // SEARCH RESULTS across everything
          results.length === 0
            ? <Text style={styles.empty}>No trades match “{q}”.</Text>
            : results.map((t) => <TradeRow key={t.id} t={t} />)
        ) : cat ? (
          // INSIDE a category
          <>
            <TouchableOpacity style={styles.back} onPress={() => setCat(null)}>
              <Icon name="chevronLeft" size={16} color={C.indigo} />
              <Text style={styles.backText}>All categories</Text>
            </TouchableOpacity>
            {inCat.map((t) => <TradeRow key={t.id} t={t} />)}
          </>
        ) : (
          // CATEGORY GRID (8 tiles)
          tax.categories.length === 0 ? (
            <Text style={styles.empty}>
              {loadErr ? `Couldn't load trades: ${loadErr.message || loadErr}` : 'No categories found. (Check the taxonomy seed & read policy.)'}
            </Text>
          ) : (
            <View style={styles.grid}>
              {tax.categories.map((c) => (
                <TouchableOpacity key={c.id} style={styles.catTile} onPress={() => setCat(c.id)} activeOpacity={0.85}>
                  <Icon name={c.icon || 'gear'} size={22} color={C.indigo} strokeWidth={1.8} />
                  <Text style={styles.catName}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )
        )}
      </ScrollView>

      {onCancel && (
        <TouchableOpacity style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  loading: { padding: 40, alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  searchInput: { flex: 1, fontSize: 15, color: C.ink, padding: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catTile: { width: '47%', flexGrow: 1, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingVertical: 20, paddingHorizontal: 14, alignItems: 'center', gap: 10, ...shadowSm },
  catName: { fontSize: 13.5, fontWeight: '700', color: C.ink, textAlign: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, marginBottom: 4 },
  backText: { color: C.indigo, fontWeight: '600', fontSize: 14 },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  tradeName: { flex: 1, fontSize: 15, fontWeight: '600', color: C.ink },
  kindTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  kindText: { fontSize: 10, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5, textTransform: 'uppercase' },
  empty: { color: C.mute, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: C.mute, fontWeight: '600', fontSize: 14 },
});
