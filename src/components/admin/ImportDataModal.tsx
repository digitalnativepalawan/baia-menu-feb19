import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export const IMPORT_DATA_KEY = 'baia_import_data';

export interface ImportedData {
  roomRevenue: number;
  foodRevenue: number;
  barRevenue: number;
  hotelServices: number;
  expenses: number;
  totalRevenue: number;
  netProfit: number;
  margin: number;
  foodCost: number;
  foodProfit: number;
  recordCount: number;
  importedAt: string;
}

export const loadImportedData = (): ImportedData | null => {
  try {
    const raw = localStorage.getItem(IMPORT_DATA_KEY);
    return raw ? (JSON.parse(raw) as ImportedData) : null;
  } catch {
    return null;
  }
};

export const clearImportedData = () => {
  localStorage.removeItem(IMPORT_DATA_KEY);
};

const FOOD_COST_PERCENTAGE = 0.35;

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

const parseCSV = (text: string): ImportedData | { error: string } => {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) {
    return { error: 'CSV file appears to be empty or has no data rows.' };
  }

  // Skip header row
  const dataLines = lines.slice(1);

  let roomRevenue = 0;
  let foodRevenue = 0;
  let barRevenue = 0;
  let hotelServices = 0;
  let expenses = 0;
  let validRows = 0;

  for (const line of dataLines) {
    const row = parseCSVLine(line);
    if (row.length < 6) continue;

    // Columns: Date, Qty, Item, Category, Amount (PHP), Payment
    const category = row[3] ?? '';
    const amountStr = row[4] ?? '';
    const payment = row[5] ?? '';

    const amount = parseFloat(amountStr.replace(/[,₱\s]/g, '')) || 0;
    if (amount <= 0) continue;

    const catLower = category.toLowerCase();
    const payLower = payment.toLowerCase();

    validRows++;

    // Room Revenue: OTA or BANK TRANSFER payment method
    if (
      payLower.includes('ota') ||
      payLower.includes('bank transfer') ||
      payLower.includes('bank_transfer')
    ) {
      roomRevenue += amount;
    }
    // Expenses: "Extra Charges" category
    else if (catLower.includes('extra charge')) {
      expenses += amount;
    }
    // Food Revenue: Restaurant category + CASH payment
    else if (catLower.includes('restaurant') && payLower.includes('cash')) {
      foodRevenue += amount;
    }
    // Bar Income: Bar category + CASH payment
    else if (catLower.includes('bar') && payLower.includes('cash')) {
      barRevenue += amount;
    }
    // Hotel Services: everything else
    else {
      hotelServices += amount;
    }
  }

  if (validRows === 0) {
    return {
      error:
        'No valid data rows found. Make sure the CSV has columns: Date, Qty, Item, Category, Amount (PHP), Payment.',
    };
  }

  const totalRevenue = roomRevenue + foodRevenue + barRevenue + hotelServices;
  const netProfit = totalRevenue - expenses;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const foodCost = foodRevenue * FOOD_COST_PERCENTAGE;
  const foodProfit = foodRevenue - foodCost;

  return {
    roomRevenue,
    foodRevenue,
    barRevenue,
    hotelServices,
    expenses,
    totalRevenue,
    netProfit,
    margin,
    foodCost,
    foodProfit,
    recordCount: validRows,
    importedAt: new Date().toISOString(),
  };
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (data: ImportedData) => void;
}

const fmt = (n: number) =>
  n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ImportDataModal = ({ open, onOpenChange, onImported }: Props) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) || '';
      const parsed = parseCSV(text);
      setLoading(false);

      if ('error' in parsed) {
        setError(parsed.error);
      } else {
        localStorage.setItem(IMPORT_DATA_KEY, JSON.stringify(parsed));
        setResult(parsed);
        onImported(parsed);
        toast.success(`Imported ${parsed.recordCount} records — dashboard updated`);
      }
    };
    reader.onerror = () => {
      setLoading(false);
      setError('Failed to read the file. Please try again.');
    };
    reader.readAsText(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const summaryItems = result
    ? [
        { label: 'Room Revenue', value: result.roomRevenue },
        { label: 'Food Revenue', value: result.foodRevenue },
        { label: 'Bar Income', value: result.barRevenue },
        { label: 'Hotel Services', value: result.hotelServices },
        { label: 'Total Revenue', value: result.totalRevenue },
        { label: 'Expenses', value: result.expenses },
        { label: 'Net Profit', value: result.netProfit },
        { label: 'Food Cost', value: result.foodCost },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-sm tracking-wider">Import Data</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* CSV format hint */}
          <div className="bg-secondary/50 rounded p-3 text-xs font-body text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Expected CSV columns:</p>
            <p className="font-mono">Date, Qty, Item, Category, Amount (PHP), Payment</p>
            <p className="mt-1">
              Payment values: <span className="text-foreground">CASH</span>,{' '}
              <span className="text-foreground">OTA</span>,{' '}
              <span className="text-foreground">Bank Transfer</span>
            </p>
          </div>

          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="font-body text-sm text-muted-foreground">Processing…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="font-body text-sm text-foreground">
                  Click to select or drag & drop a CSV file
                </p>
                <p className="font-body text-xs text-muted-foreground">.csv files only</p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleInputChange}
          />

          {/* Error state */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/30">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="font-body text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Success state */}
          {result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30">
                <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                <p className="font-body text-xs text-green-400">
                  {result.recordCount} records imported. Dashboard updated.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {summaryItems.map(r => (
                  <div key={r.label} className="bg-secondary/50 rounded p-2">
                    <p className="font-body text-[10px] text-muted-foreground">{r.label}</p>
                    <p className="font-body text-xs text-foreground font-medium">₱{fmt(r.value)}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="font-body text-xs"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ImportDataModal;
