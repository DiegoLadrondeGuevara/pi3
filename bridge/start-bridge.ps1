[CmdletBinding()]
param(
    [string]$Port = 'auto',
    [ValidateSet('simulated', 'unknown', 'real')]
    [string]$Mode = 'simulated',
    [ValidateRange(0.5, 30.0)]
    [double]$Interval = 2.0,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$bridgeDir = $PSScriptRoot
$venvPython = Join-Path $bridgeDir '.venv\Scripts\python.exe'
$envFile = Join-Path $bridgeDir '.env'

try {
    if (-not (Test-Path -LiteralPath $venvPython)) {
        $launcher = $null
        if (Get-Command python -ErrorAction SilentlyContinue) {
            $versionText = & python --version
            if ($LASTEXITCODE -eq 0 -and $versionText -match '^Python (\d+)\.(\d+)') { $launcher = 'python' }
        }
        if (-not $launcher -and (Get-Command py -ErrorAction SilentlyContinue)) {
            $versionText = & py -3 --version
            if ($LASTEXITCODE -eq 0 -and $versionText -match '^Python (\d+)\.(\d+)') { $launcher = 'py' }
        }
        if (-not $launcher) { throw 'Falta Python 3.10 o superior. Instálalo y vuelve a ejecutar este script.' }
        if ([int]$matches[1] -lt 3 -or ([int]$matches[1] -eq 3 -and [int]$matches[2] -lt 10)) {
            throw 'Se necesita Python 3.10 o superior con el módulo venv.'
        }
        Write-Host 'Creando entorno virtual en bridge\.venv ...'
        if ($launcher -eq 'py') {
            & py -3 -m venv (Join-Path $bridgeDir '.venv')
        } else {
            & python -m venv (Join-Path $bridgeDir '.venv')
        }
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno virtual.' }
    }

    $venvVersion = & $venvPython --version
    if ($LASTEXITCODE -ne 0 -or $venvVersion -notmatch '^Python (\d+)\.(\d+)') { throw 'El entorno virtual de Python no funciona.' }
    if ([int]$matches[1] -lt 3 -or ([int]$matches[1] -eq 3 -and [int]$matches[2] -lt 10)) {
        throw 'El entorno virtual usa Python anterior a 3.10. Recrea bridge\.venv y vuelve a ejecutar.'
    }

    $packages = & $venvPython -m pip list --disable-pip-version-check --format=freeze
    if ($LASTEXITCODE -ne 0 -or -not ($packages | Where-Object { $_ -match '^pyserial==3\.5$' })) {
        Write-Host 'Instalando la dependencia pyserial 3.5 ...'
        & $venvPython -m pip install -r (Join-Path $bridgeDir 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar pyserial. Comprueba Internet y vuelve a intentar.' }
    }

    if (-not (Test-Path -LiteralPath $envFile)) {
        Copy-Item -LiteralPath (Join-Path $bridgeDir '.env.example') -Destination $envFile
        throw 'Se creó bridge\.env. Abre ese archivo, pega DEVICE_HMAC_KEY desde la PC anterior y ejecuta el script otra vez.'
    }

    $config = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') { $config[$matches[1]] = $matches[2].Trim() }
    }
    if ($config['DEVICE_ID'] -ne 'sp32-001') { throw 'Revisa DEVICE_ID en bridge\.env; este prototipo usa sp32-001.' }
    if (-not $config['SMART_PPE_API_URL'] -or $config['SMART_PPE_API_URL'] -notmatch '^https://[^\s]+$') {
        throw 'Revisa SMART_PPE_API_URL en bridge\.env; debe ser una URL HTTPS.'
    }
    if (-not $DryRun -and (-not $config['DEVICE_HMAC_KEY'] -or $config['DEVICE_HMAC_KEY'].Length -lt 32)) {
        throw 'Falta DEVICE_HMAC_KEY en bridge\.env. Cópiala de forma privada desde la PC donde funciona el puente.'
    }

    # Evita que variables de entorno antiguas anulen los valores de bridge\.env.
    $env:DEVICE_ID = $config['DEVICE_ID']
    $env:SMART_PPE_API_URL = $config['SMART_PPE_API_URL']
    $env:DEVICE_HMAC_KEY = $config['DEVICE_HMAC_KEY']

    $bridgeArgs = @('-u', (Join-Path $bridgeDir 'bridge.py'), '--port', $Port, '--interval', $Interval.ToString([System.Globalization.CultureInfo]::InvariantCulture), '--mode', $Mode)
    if ($DryRun) { $bridgeArgs += '--dry-run' }
    Write-Host "Iniciando Smart-PPE: puerto=$Port, modo=$Mode, intervalo=$Interval s, prueba=$DryRun"
    Write-Host 'Detener con Ctrl+C. Cierra el Monitor Serie de Arduino antes de iniciar.'
    & $venvPython @bridgeArgs
    exit $LASTEXITCODE
}
catch {
    [Console]::Error.WriteLine("Error: $($_.Exception.Message)")
    exit 1
}
