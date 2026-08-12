import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured ? createClient(url, anonKey) : null

// Storage bucket for receipts, bill files, and the org logo.
export const FILES_BUCKET = 'files'

export async function uploadFile(file, folder) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(FILES_BUCKET).upload(path, file)
  if (error) throw error
  return path
}

export async function signedUrl(path, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, expiresIn)
  if (error) throw error
  return data.signedUrl
}
