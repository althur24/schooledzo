import { Modal, Button } from '@/components/ui'

interface ConfirmDialogProps {
    open: boolean
    title: string
    message: React.ReactNode
    confirmLabel?: string
    cancelLabel?: string
    variant?: 'danger' | 'primary'
    loading?: boolean
    onConfirm: () => void
    onCancel: () => void
}

/** Dialog konfirmasi konsisten (delete, export, dsb) */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Ya, Lanjutkan',
    cancelLabel = 'Batal',
    variant = 'primary',
    loading = false,
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    return (
        <Modal open={open} onClose={onCancel} title={title}>
            <div className="space-y-4">
                <div className={`p-4 rounded-xl border text-sm ${variant === 'danger'
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30 text-red-800 dark:text-red-300'
                    : 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300'
                    }`}>
                    {message}
                </div>
                <div className="flex gap-3">
                    <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={loading}>
                        {cancelLabel}
                    </Button>
                    {variant === 'danger' ? (
                        <button
                            onClick={onConfirm}
                            disabled={loading}
                            className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-60"
                        >
                            {loading ? 'Memproses...' : confirmLabel}
                        </button>
                    ) : (
                        <Button className="flex-1" onClick={onConfirm} loading={loading}>
                            {confirmLabel}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    )
}
