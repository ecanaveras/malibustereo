@description('Lowercase globally unique prefix, 3–16 alphanumeric characters, starting with a letter.')
@minLength(3)
@maxLength(16)
param prefix string
param location string = resourceGroup().location
@allowed(['Free_F1', 'Standard_S1'])
param pubsubSku string = 'Free_F1'

resource pubsub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: '${prefix}-live'
  location: location
  kind: 'WebPubSub'
  sku: {
    name: pubsubSku
    capacity: 1
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    // Diagnostics do not record message bodies.
    liveTraceConfiguration: { enabled: 'false' }
  }
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${prefix}presence'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}
// Output resource names only: never output secrets to deployment logs.
output pubsubName string = pubsub.name
output storageName string = storage.name
