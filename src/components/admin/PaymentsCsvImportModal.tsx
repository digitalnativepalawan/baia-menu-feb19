import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';

interface PaymentsCsvImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

const parseDate = (raw: string): string | null => {
  const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const isoMatch = raw.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) return raw;
  return null;
};

const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

const PaymentsCsvImportModal = ({ open, onOpenChange, onComplete }: PaymentsCsvImportModalProps) => {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: number; errorDetails: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    setResult(null);

    const text = await file.text();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast.error('CSV must have a header + at least one data row');
      setImporting(false);
      return;
    }

    const rows: { source: string; amount: number; expected_date: string }[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      // Expected columns: Date, Item, Category, Amount (PHP), Payment
      if (cols.length < 4) {
        errors.push(`Row ${i}: Not enough columns (need at least 4)`);
        continue;
      }

      const [dateRaw, , category, amountRaw] = cols;

      const expected_date = parseDate(dateRaw);
      if (!expected_date) {
        errors.push(`Row ${i}: Invalid date "${dateRaw}"`);
        continue;
      }

      const amount = parseFloat(amountRaw);
      if (isNaN(amount) || amount < 0) {
        errors.push(`Row ${i}: Invalid amount "${amountRaw}"`);
        continue;
      }

      if (!category) {
        errors.push(`Row ${i}: Missing category`);
        continue;
      }

      rows.push({ source: category, amount, expected_date });
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('resort_ops_incoming_payments').insert(rows);
      if (error) {
        errors.push(`DB error: ${error.message}`);
        setResult({ success: 0, errors: errors.length, errorDetails: errors });
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
        return;
      }
      onComplete();
      const errMsg = errors.length > 0 ? `, ${errors.length} failed` : '';
      toast.success(`${rows.length} row${rows.length !== 1 ? 's' : ''} imported${errMsg}`);
    }

    setResult({ success: rows.length, errors: errors.length, errorDetails: errors });
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-wider">Import Payments CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="font-body text-sm text-muted-foreground">
            Upload a CSV file with the following columns to bulk import incoming payments.
          </p>

          <div className="font-body text-xs text-muted-foreground p-2 rounded border border-border bg-muted/50">
            <p className="font-medium text-foreground mb-1">Required CSV Columns:</p>
            <p>Date, Item, Category, Amount (PHP), Payment</p>
          </div>

          <div className="space-y-2">
            <label className="font-body text-xs text-muted-foreground">Upload CSV file</label>
            <Input type="file" accept=".csv" ref={fileRef} className="bg-secondary border-border text-foreground font-body" />
          </div>

          <Button size="sm" onClick={handleImport} disabled={importing} className="w-full">
            <Upload className="w-3.5 h-3.5 mr-1.5" /> {importing ? 'Importing...' : 'Import'}
          </Button>

          {result && (
            <div className="p-3 rounded border border-border bg-secondary space-y-1">
              <p className="font-body text-sm text-foreground">
                ✅ {result.success} imported · ❌ {result.errors} errors
              </p>
              {result.errorDetails.length > 0 && (
                <div className="max-h-32 overflow-y-auto">
                  {result.errorDetails.map((e, i) => (
                    <p key={i} className="font-body text-xs text-destructive">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PaymentsCsvImportModal;
