/**
 * The sync server answered 404 for a file it used to list: the entry was
 * deleted there (manually, from another device, or by history retention).
 */
export class ServerFileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerFileNotFoundError';
  }
}
