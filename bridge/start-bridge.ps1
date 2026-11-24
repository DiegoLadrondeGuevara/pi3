[CmdletBinding()]
param(
    [string]$Port = 'auto',
    [ValidateSet('simulated', 'unknown', 'real')]
    [string]$Mode = 'unknown',
    [ValidateRange(0.5, 30.0)]
    [double]$Interval = 2.0,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$bridgeDir = $PSScriptRoot
$venvPython = Join-Path $bridgeDir '.venv\Scripts\python.exe'
$envFile = Join-Path $bridgeDir '.env'
$venvDir = Join-Path $bridgeDir '.venv'

try {
    $needsVenv = -not (Test-Path -LiteralPath $venvPython)
    if (-not $needsVenv) {
        & $venvPython -c 'import sys; sys.exit(sys.version_info < (3, 10))'
        $needsVenv = $LASTEXITCODE -ne 0
        if ($needsVenv) { Write-Host 'Reparando entorno virtual de Python ...' }
    }
    if ($needsVenv) {
        $launcher = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } elseif (Get-Command python -ErrorAction SilentlyContinue) { 'python' } else { $null }
        if (-not $launcher) {
            throw 'Falta Python 3.10 o superior. Instálalo y vuelve a ejecutar este script.'
        }
        $launcherArgs = if ($launcher -eq 'py') { @('-3') } else { @() }
        & $launcher @launcherArgs -c 'import sys; sys.exit(sys.version_info < (3, 10))'
        if ($LASTEXITCODE -ne 0) {
            throw 'Se necesita Python 3.10 o superior con el módulo venv.'
        }
        Write-Host 'Creando entorno virtual en bridge\.venv ...'
        & $launcher @launcherArgs -m venv --clear $venvDir
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno virtual.' }
    }

    & $venvPython -c 'import importlib.util as u,importlib.metadata as m,sys; sys.exit(not u.find_spec(''serial'') or m.version(''pyserial'') != ''3.5'')'
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Instalando la dependencia pyserial 3.5 ...'
        & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $bridgeDir 'requirements.txt')
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'Reparando pip y reintentando instalación ...'
            & $venvPython -m ensurepip --upgrade
            & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $bridgeDir 'requirements.txt')
        }
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar pyserial. Comprueba Internet y vuelve a intentar.' }
    }

    if (-not (Test-Path -LiteralPath $envFile)) {
        $misnamed = Join-Path $bridgeDir 'env'
        if (Test-Path -LiteralPath $misnamed -PathType Leaf) {
            Move-Item -LiteralPath $misnamed -Destination $envFile
            Write-Host 'Encontré el archivo env sin punto; lo corregí a .env.'
        } else {
            Copy-Item -LiteralPath (Join-Path $bridgeDir '.env.example') -Destination $envFile
            throw 'Se creó bridge\.env. Pega DEVICE_HMAC_KEY de forma privada y ejecuta este mismo comando otra vez.'
        }
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
