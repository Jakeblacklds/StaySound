import { OptionRow, TidalBottomSheet } from '@/src/components/tidal';
import { formatMirrorCapabilities, formatMirrorStatus } from '@/src/features/tidal/model/tidalScreenUtils';
import { tidalScreenStyles as styles } from '@/src/features/tidal/ui/tidalScreenStyles';
import { TIDAL_MIRROR_NAMES, type TidalMirrorAvailability } from '@/src/services/tidalService';
import type { TidalQuality } from '@/src/types/audio';
import { Button, TextInput } from 'react-native-paper';

const QUALITY_OPTIONS = ['LOSSLESS', 'MP3', 'HI_RES_LOSSLESS', 'LOW'] as const;

const QUALITY_DETAILS = {
    HI_RES_LOSSLESS: {
        title: 'Hi-Res Lossless (FLAC)',
        description: 'Calidad de estudio (24-bit). El mejor sonido posible.',
        status: '✓ Máximo detalle · ✗ Archivos gigantes',
        icon: 'diamond' as const,
    },
    LOSSLESS: {
        title: 'Lossless (FLAC)',
        description: 'Calidad de CD (16-bit). Sonido puro sin pérdida.',
        status: '✓ Alta fidelidad · ✗ Archivos grandes',
        icon: 'disc' as const,
    },
    MP3: {
        title: 'MP3 (320kbps)',
        description: 'Compatibilidad amplia y buen balance tamaño/calidad.',
        status: '✓ Más compatible · ✓ Tamaño moderado',
        icon: 'musical-note' as const,
    },
    LOW: {
        title: 'Básica (AAC)',
        description: 'Calidad estándar eficiente (96kbps).',
        status: '✓ Ahorro máximo · ✓ Poco espacio',
        icon: 'leaf' as const,
    },
} as const;

type MirrorSheetProps = {
    visible: boolean;
    selectedMirror: string;
    recommendedMirrors: string[];
    legacyMirrors: string[];
    availability: Record<string, TidalMirrorAvailability>;
    showLegacy: boolean;
    accentColor: string;
    onClose: () => void;
    onSelect: (mirror: string) => void;
    onToggleLegacy: () => void;
};

type QualitySheetProps = {
    visible: boolean;
    selectedQuality: TidalQuality;
    onClose: () => void;
    onSelect: (quality: TidalQuality) => void;
};

type SettingsSheetProps = {
    visible: boolean;
    onClose: () => void;
    onOpenQuality: () => void;
    onOpenMirrors: () => void;
    onOpenSoulseek: () => void;
};

type SoulseekAuthSheetProps = {
    visible: boolean;
    username: string;
    password: string;
    isSaving: boolean;
    onClose: () => void;
    onUsernameChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSave: () => void;
};

type TidalSettingsSheetsProps = {
    mirror: MirrorSheetProps;
    quality: QualitySheetProps;
    settings: SettingsSheetProps;
    soulseekAuth: SoulseekAuthSheetProps;
};

export function TidalSettingsSheets({
    mirror,
    quality,
    settings,
    soulseekAuth,
}: TidalSettingsSheetsProps) {
    return (
        <>
            <TidalBottomSheet
                visible={mirror.visible}
                onClose={mirror.onClose}
                title="Servidores"
                subtitle="Elige el catálogo usado para encontrar música"
            >
                <OptionRow
                    icon="sparkles"
                    title="Enrutamiento automático"
                    description="Alterna servidores si falla la conexión."
                    selected={mirror.selectedMirror === 'auto'}
                    onPress={() => mirror.onSelect('auto')}
                />
                {mirror.recommendedMirrors.map(server => {
                    const serverAvailability = mirror.availability[server];
                    const isUnavailable = serverAvailability?.status === 'unavailable';
                    const isSlow = serverAvailability?.status === 'slow';

                    return (
                        <OptionRow
                            key={server}
                            icon="server"
                            title={TIDAL_MIRROR_NAMES[server] || server.replace('https://', '')}
                            description={server.replace('https://', '')}
                            status={`${formatMirrorStatus(serverAvailability)} · ${formatMirrorCapabilities(serverAvailability)}`}
                            statusTone={isUnavailable ? 'error' : isSlow ? 'warning' : 'success'}
                            selected={mirror.selectedMirror === server}
                            disabled={isUnavailable}
                            onPress={() => mirror.onSelect(server)}
                        />
                    );
                })}
                <Button
                    mode="text"
                    compact
                    onPress={mirror.onToggleLegacy}
                    textColor={mirror.accentColor}
                    style={{ alignSelf: 'flex-start', marginTop: 2, marginLeft: 6 }}
                >
                    {mirror.showLegacy ? 'Ocultar otros servidores' : 'Mostrar otros servidores'}
                </Button>
                {mirror.showLegacy
                    ? mirror.legacyMirrors.map(server => {
                        const serverAvailability = mirror.availability[server];
                        const isUnavailable = serverAvailability?.status === 'unavailable';

                        return (
                            <OptionRow
                                key={server}
                                icon="server-outline"
                                title={TIDAL_MIRROR_NAMES[server] || server.replace('https://', '')}
                                description={server.replace('https://', '')}
                                status={formatMirrorCapabilities(serverAvailability)}
                                selected={mirror.selectedMirror === server}
                                disabled={isUnavailable}
                                onPress={() => mirror.onSelect(server)}
                            />
                        );
                    })
                    : null}
            </TidalBottomSheet>

            <TidalBottomSheet
                visible={quality.visible}
                onClose={quality.onClose}
                title="Fidelidad"
                subtitle="Calidad de los archivos descargados"
            >
                {QUALITY_OPTIONS.map(option => {
                    const details = QUALITY_DETAILS[option];

                    return (
                        <OptionRow
                            key={option}
                            icon={details.icon}
                            title={details.title}
                            description={details.description}
                            status={details.status}
                            statusTone="success"
                            selected={quality.selectedQuality === option}
                            onPress={() => quality.onSelect(option)}
                        />
                    );
                })}
            </TidalBottomSheet>

            <TidalBottomSheet
                visible={settings.visible}
                onClose={settings.onClose}
                title="Ajustes de descarga"
            >
                <OptionRow
                    icon="musical-notes"
                    title="Calidad de audio"
                    description="Formato de los archivos descargados"
                    onPress={settings.onOpenQuality}
                />
                <OptionRow
                    icon="server"
                    title="Catálogo de búsqueda"
                    description="Automático es lo recomendado"
                    onPress={settings.onOpenMirrors}
                />
                <OptionRow
                    icon="person-circle-outline"
                    title="Sesión Soulseek"
                    description="Cambia tus credenciales"
                    onPress={settings.onOpenSoulseek}
                />
            </TidalBottomSheet>

            <TidalBottomSheet
                visible={soulseekAuth.visible}
                onClose={soulseekAuth.onClose}
                title="Conectar Soulseek"
                subtitle="Configura tu cuenta para buscar y descargar música."
            >
                <TextInput
                    mode="outlined"
                    label="Usuario"
                    value={soulseekAuth.username}
                    onChangeText={soulseekAuth.onUsernameChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.soulseekAuthInput}
                />
                <TextInput
                    mode="outlined"
                    label="Password"
                    value={soulseekAuth.password}
                    onChangeText={soulseekAuth.onPasswordChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    style={styles.soulseekAuthInput}
                />
                <Button
                    mode="contained"
                    onPress={soulseekAuth.onSave}
                    loading={soulseekAuth.isSaving}
                    disabled={soulseekAuth.isSaving}
                    contentStyle={styles.soulseekAuthButtonContent}
                >
                    Guardar credenciales
                </Button>
            </TidalBottomSheet>
        </>
    );
}
