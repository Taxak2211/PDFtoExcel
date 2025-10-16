
export interface Transaction {
  date: string;
  description: string;
  debit?: number;
  credit?: number;
  balance?: number;
}
