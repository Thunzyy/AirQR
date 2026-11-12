/**
 * FileDropzone - File/folder selection component
 */

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSize } from '../../utils/format';

const IconFolder = () => (
  <svg className="airqr-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

const IconFile = () => (
  <svg className="airqr-icon w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

interface FileDropzoneProps {
  selectedFiles: File[] | null;
  selectedFolderName: string | null;
  onFileSelect: (files: File[], folderName: string | null) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({
  selectedFiles,
  selectedFolderName,
  onFileSelect,
}) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const openPicker = (input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    input.value = '';

    if (input.showPicker instanceof Function) {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall back to click() for browsers that gate showPicker().
      }
    }

    input.click();
  };

  const forwardSelectedFiles = (files: FileList | File[]) => {
    if (!files || files.length === 0) {
      return;
    }

    const fileArray = Array.from(files);
    const paths = fileArray.map((file) => file.webkitRelativePath || file.name);
    const folderName = paths[0]?.includes("/") ? paths[0].split("/")[0] : null;

    onFileSelect(fileArray, folderName);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    forwardSelectedFiles(event.target.files ?? []);
  };

  const handleDropzoneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openPicker(fileInputRef.current);
  };

  const handleDropzoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragActive(true);
  };

  const handleDropzoneDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    setIsDragActive(false);
  };

  const handleDropzoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    forwardSelectedFiles(event.dataTransfer.files);
  };

  return (
    <>
      <div
        role="region"
        aria-label="File drop zone"
        tabIndex={0}
        onKeyDown={handleDropzoneKeyDown}
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
        className={`airqr-liquid-card rounded-[34px] p-6 transition-all ${
          isDragActive
            ? "bg-[var(--airqr-card-hover)] shadow-[var(--airqr-shadow-strong)]"
            : selectedFiles
            ? "bg-[var(--airqr-card-hover)]"
            : ""
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airqr-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--airqr-app-bg)]`}
      >
        {/* Selected Files Display */}
        {selectedFiles && (
          <div className="mb-4 flex items-center gap-4 border-b border-[var(--airqr-divider)] pb-4">
            <div
              data-testid="encoder-selected-file-icon"
              className="airqr-liquid-icon flex size-12 shrink-0 overflow-hidden text-[var(--airqr-text-primary)]"
            >
              {selectedFolderName ? <IconFolder /> : <IconFile />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold text-[var(--airqr-text-primary)]">
                {selectedFolderName
                  ? selectedFolderName
                  : selectedFiles.length === 1
                  ? selectedFiles[0].name
                  : t('encoder.filesSelected', { count: selectedFiles.length })}
              </p>
              <p className="text-sm text-[var(--airqr-text-muted)]">
                {formatSize(selectedFiles.reduce((acc, f) => acc + f.size, 0))}
                {selectedFiles.length > 1 && ` • ${t('encoder.itemsCount', { count: selectedFiles.length })}`}
              </p>
            </div>
          </div>
        )}

        {/* Selection Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => openPicker(fileInputRef.current)}
            className="airqr-liquid-subcard flex items-center justify-center gap-2 rounded-[24px] p-4 text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)]"
          >
            <IconFile />
            <span className="font-semibold">
              {t('encoder.selectFiles')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => openPicker(folderInputRef.current)}
            className="airqr-liquid-subcard flex items-center justify-center gap-2 rounded-[24px] p-4 text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)]"
          >
            <IconFolder />
            <span className="font-semibold">
              {t('encoder.selectFolder')}
            </span>
          </button>
        </div>

        {!selectedFiles && (
          <p className="mt-3 text-center text-sm text-[var(--airqr-text-muted)]">
            {t('encoder.dropzone')}
          </p>
        )}
      </div>

      {/* File input */}
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {/* Folder input */}
      <input
        ref={folderInputRef}
        type="file"
        className="sr-only"
        // @ts-expect-error webkitdirectory is a non-standard attribute
        webkitdirectory=""
        onChange={handleFileChange}
        tabIndex={-1}
      />
    </>
  );
};

export default FileDropzone;
