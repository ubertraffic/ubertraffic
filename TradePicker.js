// TradePicker.js — the worker's "add a capability" picker. Same researched IA as the job-post
// picker (search + popular shortcuts + a few collapsed folders), so the whole app picks trades the
// same clean way. Replaces the old category-grid + kind-tag layout that read as "all over the place"
// (ALL-CAPS tags, near-duplicate rows). Self-contained.
// Props: onPick(trade { id, name, kind, category_id }) · onCancel()
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { loadTaxonomy, searchTrades, featuredTrades, pickerFolders } from './taxonomyService';
import { C, S, R, T } from './theme';

export default function TradePicker({ onPick, onCancel }) {
  const [tax, setTax] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});   // which folder is expanded

  useEffect(() => {
    let alive = true;
    loadTaxonomy().then((t) => { if (alive) setTax(t); }).catch(() => { if (alive) setTax({ categories: [], trades: [] }); });
    return () => { alive = false; };
  }, []);

  if (!tax) return <View style={styles.loading}><ActivityIndicator color={C.indigo} /></View>;

  const featured = featuredTrades(tax, 6);
  const folders = pickerFolders(tax, { task: C.amber, work: C.green, skilled: C.indigo, equipment: '#2C6E8F' });
  const hits = q.trim() ? searchTrades(tax, q) : [];

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBar}>
        <Text style={{ fontSize: 14 }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search — traffic, cleaner, excavator…"
          placeholderTextColor={C.mute2}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          returnKeyType="search"
        />
        {q ? <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={styles.clear}>✕</Text></TouchableOpacity> : null}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
        {q.trim() ? (
          hits.length === 0
            ? <Text style={styles.empty}>No match for “{q.trim()}”.</Text>
            : <View style={styles.chipWrap}>
                {hits.map((t) => (
                  <TouchableOpacity key={t.id} style={[styles.chip, { borderColor: C.indigo }]} onPress={() => onPick(t)} activeOpacity={0.8}>
                    <Text style={styles.chipT}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
        ) : (
          <>
            {featured.length > 0 && (
              <>
                <Text style={styles.section}>POPULAR</Text>
                <View style={styles.chipWrap}>
                  {featured.map((t) => (
                    <TouchableOpacity key={t.id} style={styles.featChip} onPress={() => onPick(t)} activeOpacity={0.85}>
                      <Text style={styles.featChipT}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <Text style={[styles.section, { marginTop: 20 }]}>BROWSE ALL</Text>
            {folders.map((f) => {
              const isOpen = !!open[f.key];
              return (
                <View key={f.key} style={styles.folder}>
                  <TouchableOpacity style={styles.folderHead} activeOpacity={0.7} onPress={() => setOpen((p) => ({ ...p, [f.key]: !isOpen }))}>
                    <View style={[styles.folderDot, { backgroundColor: f.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.folderTitle}>{f.label}<Text style={styles.folderCount}>  {f.trades.length}</Text></Text>
                      <Text style={styles.folderSub}>{f.sub}</Text>
                    </View>
                    <Text style={[styles.folderChev, { transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }]}>›</Text>
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={[styles.chipWrap, { marginBottom: 12 }]}>
                      {f.trades.map((t) => (
                        <TouchableOpacity key={t.id} style={[styles.chip, { borderColor: f.color }]} onPress={() => onPick(t)} activeOpacity={0.8}>
                          <Text style={styles.chipT}>{t.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </>
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
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 15, color: C.ink, padding: 0 },
  clear: { color: C.mute2, fontWeight: '700', fontSize: 15 },
  section: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: C.mute, marginTop: 16, marginBottom: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.panel },
  chipT: { fontSize: 14, fontWeight: '700', color: C.ink },
  featChip: { backgroundColor: C.indigo, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 11 },
  featChipT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  folder: { borderTopWidth: 1, borderTopColor: C.line },
  folderHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  folderDot: { width: 10, height: 10, borderRadius: 5 },
  folderTitle: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  folderCount: { fontSize: 13, fontWeight: '700', color: C.mute2 },
  folderSub: { fontSize: 12, color: C.mute, marginTop: 2, fontWeight: '600' },
  folderChev: { fontSize: 22, color: C.mute2, fontWeight: '300' },
  empty: { color: C.mute, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: C.mute, fontWeight: '600', fontSize: 14 },
});
