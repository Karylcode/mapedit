using System;
using System.Linq;
using GLTF.Schema;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityGLTF.Plugins;

namespace Mapedit.Editor
{
    /// <summary>UnityGLTF discovers this plugin automatically through its type cache.</summary>
    public sealed class MapeditImportPlugin : GLTFImportPlugin
    {
        public MapeditMarkerMapping markerMapping;
        public override string DisplayName => "Mapedit game metadata";
        public override string Description => "Creates mesh colliders, trigger boxes, and prefabs from extras.mapedit.";
        public override bool EnabledByDefault => true;

        public override GLTFImportPluginContext CreateInstance(GLTFImportContext context)
        {
            var mapping = markerMapping;
            if (!mapping)
            {
                var paths = AssetDatabase.FindAssets("t:MapeditMarkerMapping")
                    .Select(AssetDatabase.GUIDToAssetPath).OrderBy(path => path, StringComparer.Ordinal).ToArray();
                if (paths.Length == 1) mapping = AssetDatabase.LoadAssetAtPath<MapeditMarkerMapping>(paths[0]);
                else if (paths.Length > 1)
                    Debug.LogWarning("Mapedit found multiple marker mappings. Select one in the UnityGLTF Mapedit plugin settings.");
            }
            if (mapping && context.AssetContext != null)
            {
                context.AssetContext.DependsOnSourceAsset(AssetDatabase.GetAssetPath(mapping));
                foreach (var entry in mapping.entries)
                    if (entry != null && entry.prefab)
                        context.AssetContext.DependsOnSourceAsset(AssetDatabase.GetAssetPath(entry.prefab));
            }
            return new MapeditImportContext(mapping);
        }
    }

    public sealed class MapeditImportContext : GLTFImportPluginContext
    {
        private readonly MapeditMarkerMapping mapping;

        public MapeditImportContext(MapeditMarkerMapping mapping) { this.mapping = mapping; }

        public override void OnAfterImportNode(Node node, int nodeIndex, GameObject nodeObject)
        {
            if (!(node.Extras?["mapedit"] is JObject metadata)) return;
            if (metadata["collider"] is JObject collider)
            {
                var type = collider.Value<string>("type");
                if (type == "mesh")
                {
                    foreach (var filter in nodeObject.GetComponentsInChildren<MeshFilter>(true))
                    {
                        if (!filter.sharedMesh) continue;
                        var meshCollider = filter.GetComponent<MeshCollider>();
                        if (!meshCollider) meshCollider = filter.gameObject.AddComponent<MeshCollider>();
                        meshCollider.sharedMesh = filter.sharedMesh;
                        meshCollider.convex = false;
                    }
                }
                else if (type == "box" && collider["size"] is JArray size && size.Count == 3)
                {
                    var box = nodeObject.GetComponent<BoxCollider>();
                    if (!box) box = nodeObject.AddComponent<BoxCollider>();
                    box.center = Vector3.zero;
                    box.size = new Vector3(size[0].Value<float>(), size[1].Value<float>(), size[2].Value<float>());
                    box.isTrigger = collider.Value<bool?>("isTrigger") ?? false;
                }
            }

            if (metadata.Value<string>("kind") != "marker") return;
            var marker = nodeObject.GetComponent<MapeditMarker>();
            if (!marker) marker = nodeObject.AddComponent<MapeditMarker>();
            marker.objectRef = metadata.Value<string>("ref");
            marker.markerType = metadata.Value<string>("markerType");
            marker.propertiesJson = metadata["properties"]?.ToString(Formatting.None) ?? "{}";
            var prefab = mapping ? mapping.FindPrefab(marker.markerType) : null;
            if (!prefab) return;

            // Keep an identity wrapper for stable references, trigger volumes and game properties.
            // The visible/gameplay object is the mapped prefab at the imported node's transform.
            var instance = UnityEngine.Object.Instantiate(prefab, nodeObject.transform, false);
            instance.name = prefab.name;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;
        }
    }
}
