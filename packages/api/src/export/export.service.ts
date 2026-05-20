/**
 * ExportService — generate xlsx and PDF reports
 * Feature: universal-data-calibration-platform
 */
import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';
import { DynamicField } from '../schema/schema.service';
import { DataRecord } from '../records/record.service';

export class ExportError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ExportError'; }
}

export async function generateXlsx(
  records: DataRecord[],
  schema: DynamicField[],
  tenantName: string,
  filters: string,
): Promise<Buffer> {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet('Data');

  // Row 1: filter criteria annotation
  worksheet.addRow([`Filters: ${filters || 'none'}`]);

  // Row 2: tenant name + export timestamp
  worksheet.addRow([`Tenant: ${tenantName}`, `Exported: ${new Date().toISOString()}`]);

  // Row 3: column headers
  worksheet.addRow(schema.map((f) => f.name));

  // Rows 4+: record data
  for (const record of records) {
    const row = schema.map((f) => record.data[f.id] ?? '');
    worksheet.addRow(row);
  }

  return await workbook.xlsx.writeBuffer() as unknown as Buffer;
}

export async function generatePdf(
  records: DataRecord[],
  schema: DynamicField[],
  tenantName: string,
  filters: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(16).text(tenantName, { align: 'center' });
    doc.fontSize(10).text(`Exported: ${new Date().toISOString()}`, { align: 'center' });
    doc.fontSize(10).text(`Filters: ${filters || 'none'}`, { align: 'center' });
    doc.moveDown();

    // Table headers
    doc.fontSize(8);
    const colWidth = 500 / schema.length;
    let x = 50;
    for (const field of schema) {
      doc.text(field.name, x, doc.y, { width: colWidth, continued: true });
      x += colWidth;
    }
    doc.text(''); // end continued
    doc.moveDown(0.5);

    // Table rows
    for (const record of records) {
      x = 50;
      for (const field of schema) {
        const val = String(record.data[field.id] ?? '');
        doc.text(val.slice(0, 30), x, doc.y, { width: colWidth, continued: true });
        x += colWidth;
      }
      doc.text(''); // end continued
      doc.moveDown(0.3);
    }

    doc.end();
  });
}
