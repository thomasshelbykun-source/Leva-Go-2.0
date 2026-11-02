-- 0004: pagamentos manuais por M-Pesa e e-Mola (02/11/2026, decisão do proprietário: sem API de pagamentos).
-- O cliente transfere para o número da LevaGo e indica o código da transacção. O pedido só avança quando
-- um super-administrador confirma, no extracto da conta, que o valor entrou. Uma captura de ecrã nunca confirma.
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS manual_txn_ref TEXT;        -- código da transacção M-Pesa/e-Mola
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS manual_submitted_at TEXT;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS reviewed_by TEXT REFERENCES users(id);
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS reviewed_at TEXT;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS review_note TEXT;
-- O mesmo código de transacção não pode pagar dois pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pi_manual_txn ON payment_intents (provider, upper(manual_txn_ref)) WHERE manual_txn_ref IS NOT NULL;

UPDATE system_settings
   SET value = ('{"mpesa_number":"","emola_number":"","account_name":""}'::jsonb || value::jsonb)::text
 WHERE key = 'payments';
