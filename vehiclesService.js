// vehiclesService.js — the ONE place the app reads/writes a user's vehicles ("the rig").
// A vehicle carries its own registration + insurance with expiries, so the compliance picture is
// per-vehicle, not one blanket flag. Owned by the caller (RLS: operator_id = auth.uid()). Works for
// both workers (their work ute) and companies (their fleet). Equipment/plant stays as capabilities.
import { supabase } from './supabaseClient';

// Common vehicle types on a construction site — drives the add-form chips.
export const VEHICLE_TYPES = ['Ute', 'Van', 'Truck', 'Tipper', 'Trailer', 'Car', 'Excavator', 'Bobcat', 'Other'];

export async function listMyVehicles() {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  const { data, error } = await supabase
    .from('operator_vehicles')
    .select('id, type, make_model, rego, rego_expires, insurer, insurance_expires, created_at')
    .eq('operator_id', u.user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Add or update a vehicle. Pass id to update, omit to insert. Dates are ISO (YYYY-MM-DD) or null.
export async function saveMyVehicle({ id, type, make_model, rego, rego_expires, insurer, insurance_expires }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  if (!type || !type.trim()) throw new Error('Pick a vehicle type.');
  const row = {
    operator_id: u.user.id,
    type: type.trim(),
    make_model: (make_model && make_model.trim()) ? make_model.trim() : null,
    rego: (rego && rego.trim()) ? rego.trim().toUpperCase() : null,
    rego_expires: rego_expires || null,
    insurer: (insurer && insurer.trim()) ? insurer.trim() : null,
    insurance_expires: insurance_expires || null,
  };
  if (id) {
    const { error } = await supabase.from('operator_vehicles').update(row).eq('id', id).eq('operator_id', u.user.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('operator_vehicles').insert(row);
    if (error) throw error;
  }
}

export async function removeMyVehicle(id) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  const { error } = await supabase.from('operator_vehicles').delete().eq('id', id).eq('operator_id', u.user.id);
  if (error) throw error;
}
