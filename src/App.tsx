import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import './App.css';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface MissingField {
    row_idx: number;
    col_idx: number;
    row_name: string;
    field_name: string;
}

interface FieldUpdate {
    row_idx: number;
    col_idx: number;
    value: string;
}


export default function App() {
    const [filePath, setFilePath] = useState('');
    const [status, setStatus] = useState('Ready');
    const [progress, setProgress] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isBh, set_isBh] = useState(false);
    const [isFixerOpen, setIsFixerOpen] = useState(false);
    const [currentFixIndex, setCurrentFixIndex] = useState(0);
    const [fixInputValue, setFixInputValue] = useState('');
    const [missingFields, setMissingFields] = useState<MissingField[]>([]);
    const [pendingFixes, setPendingFixes] = useState<FieldUpdate[]>([]);

    useEffect(() => {
        const unlisten = listen('import-progress', (event: any) => {
        setStatus(event.payload.message);
        if (event.payload.total > 0) {
            setProgress((event.payload.current / event.payload.total) * 100);
        }
        if (event.payload.message === "Import Complete!") {
            setIsProcessing(false);
        }
        });
        return () => { unlisten.then(f => f()); };
    }, []);

    const handleSelectFile = async () => {
        const selected = await open({ multiple: false, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
        if (selected) setFilePath(selected as string);
    };

    const handleStart = async () => {
        if (!filePath) return;
        setIsProcessing(true);
        try {
        await invoke('start_import', { filePath, isBh });
        } catch (error) {
        setStatus(`Error: ${error}`);
        setIsProcessing(false);
        }
    };

    const startFieldFixer = async () => {
    if (!filePath) {
        await message("Please select an Excel file first.", { title: "Error", kind: "error" });
        return;
    }
    try {
        const emptyFields: any = await invoke('scan_empty_fields', { filePath });
        if (emptyFields.length === 0) {
            await message("No empty fields found in the target columns!", { title: "All Good", kind: "info" });
            return;
        }
        setMissingFields(emptyFields);
        setCurrentFixIndex(0);
        setFixInputValue('');
        setPendingFixes([]);
        setIsFixerOpen(true);
    } catch (error: any) {
        await message(error, { title: "Scan Error", kind: "error" });
    }
};

    const handleNextFix = async () => {
    const currentField = missingFields[currentFixIndex];
    const updatedFixes = [...pendingFixes];

    if (fixInputValue.trim() !== '') {
        updatedFixes.push({
            row_idx: currentField.row_idx,
            col_idx: currentField.col_idx,
            value: fixInputValue
        });
    }

    setPendingFixes(updatedFixes);

    if (currentFixIndex < missingFields.length - 1) {
        setCurrentFixIndex(currentFixIndex + 1);
        setFixInputValue('');
    } else {
        // End of the list reached! Save everything and close.
        await saveAndCloseFixer(updatedFixes);
    }
};

const handleCancelFix = async () => {
    // Save whatever they entered up to this point, then close.
    await saveAndCloseFixer(pendingFixes);
};

const saveAndCloseFixer = async (updatesToSave: any) => {
    try {
        if (updatesToSave.length > 0) {
            await invoke('save_empty_fields', { filePath, updates: updatesToSave });
            await message(`Successfully saved ${updatesToSave.length} fields back to the Excel file!`, { title: 'Saved', kind: 'info' });
        }
    } catch (e:any) {
        await message(e, { title: 'Save Error', kind: 'error' });
    } finally {
        setIsFixerOpen(false);
    }
};

return (
        <main className="container" style={{ 
            minHeight: '100vh', 
            backgroundColor: '#121212', 
            color: '#e0e0e0',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>

            <div style={{
                backgroundColor: '#1e1e1e', 
                padding: '40px', 
                borderRadius: '12px', 
                width: '100%', 
                maxWidth: '600px', 
                boxShadow: '0 10px 40px rgba(0,0,0,0.5)', 
                border: '1px solid #333'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h2 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '24px', fontWeight: '700' }}>
                        Budpack
                    </h2>
                    <p style={{ margin: 0, color: '#888', fontSize: '14px' }}>Automated Sweed inventory receiving</p>
                </div>

                {/* FILE SELECTION ROW */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <input 
                        type="text" 
                        value={filePath} 
                        readOnly 
                        className="pro-input"
                        placeholder="Select Excel File (.xlsx)" 
                        style={{ flexGrow: 1, padding: '12px' }} 
                    />
                    <button 
                        className="pro-btn btn-secondary"
                        onClick={handleSelectFile} 
                        disabled={isProcessing}
                        style={{ padding: '0 20px' }}
                    >
                        Browse
                    </button>
                </div>

                {/* OPTIONS ROW */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', padding: '0 5px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#bbb' }}>
                        <input 
                            type="checkbox" 
                            className="pro-checkbox"
                            checked={isBh} 
                            onChange={(e) => set_isBh(e.target.checked)} 
                        />
                        Use Lot# as Barcode
                    </label>


                </div>

                {/* MAIN ACTIONS */}
                <div style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}>
                    <button 
                        className="pro-btn btn-primary"
                        onClick={handleStart} 
                        disabled={isProcessing || !filePath} 
                        style={{ flex: 2, padding: '14px', fontSize: '15px' }}
                    >
                        {isProcessing ? 'IMPORTING...' : 'START IMPORT'}
                    </button>

                    <button 
                        className="pro-btn btn-secondary"
                        onClick={startFieldFixer}
                        style={{ flex: 1, padding: '14px', fontSize: '14px' }}
                    >
                        Fix Missing Data
                    </button>
                </div> 

                {/* PROGRESS BAR */}
                <div style={{ 
                    backgroundColor: '#151515', 
                    padding: '15px', 
                    borderRadius: '8px', 
                    border: '1px solid #2a2a2a' 
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#aaa' }}>Status</span>
                        <span style={{ fontSize: '13px', color: '#396cd8', fontWeight: 'bold' }}>{status}</span>
                    </div>
                    <progress className="pro-progress" value={progress} max="100" />
                </div>
            </div>

            {/* FIXER WIZARD POPUP */}
            {isFixerOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', 
                    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
                }}>
                    <div style={{
                        backgroundColor: '#1e1e1e', padding: '30px', borderRadius: '12px', color: '#ffffff',
                        width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', border: '1px solid #333'
                    }}>
                        <h2 style={{ marginTop: 0, fontSize: '20px' }}>Missing Data Wizard</h2>
                        
                        <div style={{ margin: '20px 0', padding: '15px', backgroundColor: '#2a2a2a', borderRadius: '8px', borderLeft: '4px solid #ff6b6b' }}>
                            <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#aaa' }}>
                                Product: <br/> 
                                <strong style={{ color: '#fff', fontSize: '15px' }}>{missingFields[currentFixIndex]?.row_name}</strong>
                            </p>
                            <p style={{ margin: 0, fontSize: '13px', color: '#aaa' }}>
                                Needs: <br/> 
                                <span style={{ color: '#ff6b6b', fontSize: '18px', fontWeight: 'bold' }}>{missingFields[currentFixIndex]?.field_name}</span>
                            </p>
                        </div>

                        <input 
                            type="text" 
                            className="pro-input"
                            value={fixInputValue} 
                            onChange={(e) => setFixInputValue(e.target.value)} 
                            onKeyDown={(e) => e.key === 'Enter' && handleNextFix()}
                            placeholder="Enter value..."
                            autoFocus
                            style={{ width: '100%', padding: '12px', marginBottom: '20px', boxSizing: 'border-box' }}
                        />
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                            <button className="pro-btn btn-secondary" onClick={handleCancelFix} style={{ flex: 1, padding: '12px' }}>
                                Cancel & Save
                            </button>
                            <button className="pro-btn btn-primary" onClick={handleNextFix} style={{ flex: 1, padding: '12px' }}>
                                Next ➔
                            </button>
                        </div>
                        
                        <p style={{ textAlign: 'center', fontSize: '12px', color: '#666', marginTop: '20px', marginBottom: 0 }}>
                            Field {currentFixIndex + 1} of {missingFields.length}
                        </p>
                    </div>
                </div>
            )}
        </main>
    );

}

async function checkForAppUpdates() {
    try {
        console.log("Checking for updates...");
        
        const update = await check();

        if (!update) {
            console.log("App is up to date.");
            return; 
        }

        const userWantsToUpdate = await confirm(
            `Budpack ${update.version} is available!\n\nRelease Notes:\n${update.body}\n\nDo you want to download and install it now?`, 
            {
                title: 'Update Available',
                kind: 'info',
                okLabel: 'Update Now',
                cancelLabel: 'Remind Me Later'
            }
        );

        if (userWantsToUpdate) {
            console.log("Downloading and installing update...");
            
            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        console.log(`Started downloading ${event.data.contentLength} bytes`);
                        break;
                    case 'Progress':
                        console.log(`Downloaded ${event.data.chunkLength} bytes`);
                        break;
                    case 'Finished':
                        console.log('Download finished');
                        break;
                }
            });

            console.log("Install complete. Relaunching...");
            
            await relaunch();
        }
        
    } catch (error: any) {
        console.error("Failed to check for updates:", error);
        await message(`Failed to update Budpack: ${error.message}`, {
            title: 'Update Error',
            kind: 'error'
        });
    }
}

checkForAppUpdates();