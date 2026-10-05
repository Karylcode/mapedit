using UnityEngine;

namespace Mapedit
{
    /// <summary>Stable identity and game properties retained on imported marker nodes.</summary>
    public sealed class MapeditMarker : MonoBehaviour
    {
        public string objectRef;
        public string markerType;
        [TextArea] public string propertiesJson = "{}";
    }
}
