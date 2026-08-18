export const SUPABASE_URL = 'https://rlttycaajdsqovxjdjvx.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsdHR5Y2FhamRzcW92eGpkanZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MTMyNDcsImV4cCI6MjEwMjQ4OTI0N30.XgFQSVBpjs6N8QdshnC_uSJc1Mql8v9ix5_BDemGuao'

export const SUPABASE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Accept-Profile': 'covercero',
  'Content-Profile': 'covercero',
}
