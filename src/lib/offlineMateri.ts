import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface LMSOfflineDB extends DBSchema {
    materials: {
        key: string;
        value: {
            id: string;
            title: string;
            description: string | null;
            type: 'PDF' | 'VIDEO' | 'TEXT' | 'LINK' | string;
            content_text: string | null;
            content_url: string | null;
            subjectName: string;
            className: string;
            savedAt: string;
            hasBlobData: boolean;
        };
        indexes: { 'by-subject': string; 'by-date': string };
    };
    blobs: {
        key: string;
        value: {
            materialId: string;
            data: Blob;
            mimeType: string;
            fileName: string;
        };
    };
}

const DB_NAME = 'lms-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LMSOfflineDB>> | null = null;

// Initialize Database lazy
export async function getDB() {
    if (typeof window === 'undefined') return null; // Prevent SSR errors
    if (!dbPromise) {
        dbPromise = openDB<LMSOfflineDB>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('materials')) {
                    const materialStore = db.createObjectStore('materials', { keyPath: 'id' });
                    materialStore.createIndex('by-subject', 'subjectName');
                    materialStore.createIndex('by-date', 'savedAt');
                }
                if (!db.objectStoreNames.contains('blobs')) {
                    db.createObjectStore('blobs', { keyPath: 'materialId' });
                }
            },
        });
    }
    return dbPromise;
}

// Convert format from API response to Offline
export function formatToOfflineMaterial(material: any, subjectName: string, className: string, hasBlobData: boolean = false) {
    return {
        id: material.id,
        title: material.title,
        description: material.description,
        type: material.type,
        content_text: material.content_text,
        content_url: material.content_url,
        subjectName,
        className,
        savedAt: new Date().toISOString(),
        hasBlobData
    };
}

// Save Material
export async function saveMaterialOffline(materialData: any, blob?: Blob, fileName?: string) {
    const db = await getDB();
    if (!db) return false;

    const tx = db.transaction(['materials', 'blobs'], 'readwrite');
    
    // Save metadata
    await tx.objectStore('materials').put(materialData);

    // Save blob if provided (for PDF)
    if (blob && materialData.hasBlobData) {
        await tx.objectStore('blobs').put({
            materialId: materialData.id,
            data: blob,
            mimeType: blob.type,
            fileName: fileName || `${materialData.title}.pdf`
        });
    }

    await tx.done;
    return true;
}

// Check if material is saved
export async function isMaterialOffline(materialId: string): Promise<boolean> {
    const db = await getDB();
    if (!db) return false;
    const item = await db.get('materials', materialId);
    return !!item;
}

// Get all saved materials
export async function getAllOfflineMaterials() {
    const db = await getDB();
    if (!db) return [];
    return await db.getAllFromIndex('materials', 'by-date');
}

// Get specific material
export async function getMaterialOffline(materialId: string) {
    const db = await getDB();
    if (!db) return null;
    return await db.get('materials', materialId);
}

// Get Blob data
export async function getBlobOffline(materialId: string) {
    const db = await getDB();
    if (!db) return null;
    return await db.get('blobs', materialId);
}

// Remove material
export async function removeMaterialOffline(materialId: string) {
    const db = await getDB();
    if (!db) return false;

    const tx = db.transaction(['materials', 'blobs'], 'readwrite');
    await tx.objectStore('materials').delete(materialId);
    await tx.objectStore('blobs').delete(materialId);
    await tx.done;

    return true;
}

// Get Storage Size (Estimasi kasar dari blobs)
export async function getOfflineStorageSize(): Promise<number> {
    const db = await getDB();
    if (!db) return 0;
    
    const blobs = await db.getAll('blobs');
    let totalBytes = 0;
    
    for (const b of blobs) {
        totalBytes += b.data.size;
    }
    
    return totalBytes;
}
