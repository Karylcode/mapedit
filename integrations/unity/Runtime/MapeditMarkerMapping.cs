using System;
using System.Collections.Generic;
using UnityEngine;

namespace Mapedit
{
    [CreateAssetMenu(fileName = "MapeditMarkerMapping", menuName = "Mapedit/Marker Mapping")]
    public sealed class MapeditMarkerMapping : ScriptableObject
    {
        [Serializable]
        public sealed class Entry
        {
            public string markerType;
            public GameObject prefab;
        }

        public List<Entry> entries = new List<Entry>();

        public GameObject FindPrefab(string markerType)
        {
            foreach (var entry in entries)
                if (entry != null && entry.markerType == markerType && entry.prefab)
                    return entry.prefab;
            return null;
        }
    }
}
